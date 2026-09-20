// Gang Lowrider Hydraulics v1.0
// GTA San Andreas Classic + CLEO Redux JavaScript
//
// Clean rebuild based on Rockstar's own lowrider-challenge opponent logic.
// No fake hopping force is used. The car is bounced by short hydraulic pulses:
//     neutral -> ~200ms hydraulic direction -> neutral
//
// Automatic ambient behavior:
// - Los Santos gangs only: Ballas, Grove Street Families, Vagos, Aztecas.
// - Actual GTA lowriders only.
// - Car MUST already have hydraulics; this mod never installs them.
// - Disabled during missions.
// - 25% chance to show off after a qualifying traffic stop.
// - The active car is temporarily idled during preparation/pulses, then wandering AI is restored.
// - GTA's CVehicle::GetSpecialColModel() is called if the special collision slot is still -1/255.
// - CVehicle::m_nCreatedBy is temporarily spoofed as MISSION_VEHICLE (2), then restored.
// - After special-collision initialization, the car waits to settle on all four wheels before pulsing.
// - Patterns intentionally limited to: front axle, rear axle, front-left, front-right.
//
// IMPORTANT: keep [mem] in the filename. Nearby vehicle enumeration and the
// entity status byte use GTA SA 1.0 US memory.

/// <reference path=".config/sa.d.ts" />

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

const LS_CORE_GANG_MODEL_MIN = 102;
const LS_CORE_GANG_MODEL_MAX = 110;
const AZTECAS_MODEL_MIN = 114;
const AZTECAS_MODEL_MAX = 116;
const STOP_SPEED_THRESHOLD = 0.05;
const ROCKSTAR_PULSE_MS = 200;
const HYDRAULIC_SETTLE_TIMEOUT_MS = 3000;

function isLosSantosGangModel(modelId) {
    if (!Number.isInteger(modelId)) return false;
    return (
        (modelId >= LS_CORE_GANG_MODEL_MIN && modelId <= LS_CORE_GANG_MODEL_MAX) ||
        (modelId >= AZTECAS_MODEL_MIN && modelId <= AZTECAS_MODEL_MAX)
    );
}

function isStoppedSpeed(speed) {
    return typeof speed === "number" &&
        Number.isFinite(speed) &&
        Math.abs(speed) <= STOP_SPEED_THRESHOLD;
}

function isHydraulicEligible(hasHydraulics) {
    return hasHydraulics === true;
}

function isSettledForHydraulics(onAllWheels, speed) {
    return onAllWheels === true && isStoppedSpeed(speed);
}

function getSettleTimeoutMs() {
    return HYDRAULIC_SETTLE_TIMEOUT_MS;
}

// CONTROL_CAR_HYDRAULICS order:
// front-left, rear-left, front-right, rear-right.
// These four patterns are taken directly from the combinations used by
// Rockstar's lowrider opponent, narrowed to the four motions requested here.
function makeRockstarPulsePattern(patternId) {
    switch (patternId) {
        case 0: return [1.0, 0.0, 1.0, 0.0]; // front axle
        case 1: return [0.0, 1.0, 0.0, 1.0]; // rear axle
        case 2: return [1.0, 0.0, 0.0, 0.0]; // front-left
        case 3: return [0.0, 0.0, 1.0, 0.0]; // front-right
        default:return [0.0, 0.0, 0.0, 0.0];
    }
}

function getPulsePatternName(patternId) {
    switch (patternId) {
        case 0: return "FRONT";
        case 1: return "REAR";
        case 2: return "FRONT_LEFT";
        case 3: return "FRONT_RIGHT";
        default:return "NEUTRAL";
    }
}

function decodeEntityStatus(entityTypeStatusByte) {
    if (!Number.isInteger(entityTypeStatusByte)) return -1;
    return (entityTypeStatusByte >> 3) & 0x1F;
}

function getEntityTypeStatusOffset() {
    return 0x36;
}

function getPulseDurationMs() {
    return ROCKSTAR_PULSE_MS;
}

function getVehicleCreatedByOffset() {
    return 0x4A4;
}

function getVehicleSpecialColOffset() {
    return 0x48B;
}

function getSpecialColModelAddress() {
    return 0x6DF3D0;
}

function needsSpecialColInitialization(index) {
    return !isValidSpecialColIndex(index);
}

function isValidSpecialColIndex(index) {
    return Number.isInteger(index) && index >= 0 && index <= 3;
}

function shouldSpoofAsMissionVehicle(createdBy, specialColIndex) {
    return createdBy !== 2 && isValidSpecialColIndex(specialColIndex);
}

function holdCarAiForHydraulics(nativeFn, handle) {
    nativeFn("CAR_SET_IDLE", handle);
    nativeFn("SET_CAR_STATUS", handle, 3);
}

function releaseCarAiAfterHydraulics(nativeFn, handle) {
    nativeFn("CAR_WANDER_RANDOMLY", handle);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        isLosSantosGangModel,
        isStoppedSpeed,
        isHydraulicEligible,
        isSettledForHydraulics,
        getSettleTimeoutMs,
        makeRockstarPulsePattern,
        getPulsePatternName,
        decodeEntityStatus,
        getEntityTypeStatusOffset,
        getPulseDurationMs,
        getVehicleCreatedByOffset,
        getVehicleSpecialColOffset,
        getSpecialColModelAddress,
        needsSpecialColInitialization,
        isValidSpecialColIndex,
        shouldSpoofAsMissionVehicle,
        holdCarAiForHydraulics,
        releaseCarAiAfterHydraulics
    };
}

// -----------------------------------------------------------------------------
// CLEO Redux runtime
// -----------------------------------------------------------------------------

if (typeof HOST !== "undefined" && HOST === "sa") {
    const PLAYER_ID = 0;

    const ENTITY_TYPE_STATUS_OFFSET = 0x36;
    const VEHICLE_CREATED_BY_OFFSET = 0x4A4;
    const VEHICLE_SPECIAL_COL_OFFSET = 0x48B;
    const GET_SPECIAL_COL_MODEL_ADDR = 0x6DF3D0;
    const MISSION_VEHICLE = 2;
    const STATUS_PHYSICS = 3;
    const PHYSICS_ARM_DELAY_MS = 250;
    const SETTLE_TIMEOUT_MS = HYDRAULIC_SETTLE_TIMEOUT_MS;

    const VEHICLE_POOL_PTR_ADDR = 0xB74494;
    const GET_VEHICLE_PTR_ADDR = 0x54FFF0;
    const MAX_REASONABLE_POOL_SIZE = 4096;

    const OFF_MOVE_SPEED = 0x44; // CPhysical::m_vecMoveSpeed

    const SCAN_INTERVAL_MS = 100;
    const MAX_DISTANCE_FROM_CJ = 90.0;

    const STOP_MIN_MS = 2500;
    const STOP_MAX_MS = 4000;

    const SHOWOFF_CHANCE = 0.25;

    const MIN_PULSES = 3;
    const MAX_PULSES = 6;
    const PULSE_MS = ROCKSTAR_PULSE_MS;
    const NEUTRAL_MIN_MS = 350;
    const NEUTRAL_MAX_MS = 650;

    const COOLDOWN_MIN_MS = 25000;
    const COOLDOWN_MAX_MS = 40000;

    // Small horizontal movement can happen when the suspension kicks.
    // Only treat meaningful forward/sideways motion as traffic resuming.
    const HORIZONTAL_MOVE_ABORT_THRESHOLD = 0.20;

    const AUTO_TRIGGER_ENABLED = true;
    const DEBUG = false;

    const NEUTRAL_PATTERN = [0.0, 0.0, 0.0, 0.0];

    const vehicleState = new Map();
    const getVehiclePtr = Memory.Fn.Cdecl(GET_VEHICLE_PTR_ADDR);

    function debugLog(text) {
        if (DEBUG) {
            log("[GangLowriderHydraulics v1.0] " + text);
        }
    }

    function randomInt(minInclusive, maxInclusive) {
        return Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive;
    }

    function distance2D(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function readVehiclePool() {
        const pool = Memory.ReadU32(VEHICLE_POOL_PTR_ADDR, false);
        if (!pool) return null;

        const byteMap = Memory.ReadU32(pool + 0x4, false);
        const size = Memory.ReadI32(pool + 0x8, false);

        if (!byteMap || size <= 0 || size > MAX_REASONABLE_POOL_SIZE) {
            return null;
        }

        return { byteMap, size };
    }

    function getVehicleHandle(slot, poolByte) {
        return (slot << 8) + poolByte;
    }

    function isVehicleUsable(handle) {
        if (typeof handle !== "number" || handle <= 0) return false;
        if (!getVehiclePtr(handle)) return false;
        return !native("IS_CAR_DEAD", handle);
    }

    function getDriver(handle) {
        if (!isVehicleUsable(handle)) return -1;

        const driver = native("GET_DRIVER_OF_CAR", handle);
        if (typeof driver !== "number" || driver <= 0) return -1;
        if (native("IS_CHAR_DEAD", driver)) return -1;

        return driver;
    }

    function getGangDriverModel(handle) {
        const driver = getDriver(handle);
        if (driver <= 0) return -1;

        const modelId = native("GET_CHAR_MODEL", driver);
        return isLosSantosGangModel(modelId) ? modelId : -1;
    }

    function getVehicleStatus(handle) {
        if (!isVehicleUsable(handle)) return -1;
        const ptr = getVehiclePtr(handle);
        if (!ptr) return -1;
        return decodeEntityStatus(Memory.ReadU8(ptr + ENTITY_TYPE_STATUS_OFFSET, false));
    }

    function getVehicleCreatedBy(handle) {
        if (!isVehicleUsable(handle)) return -1;
        const ptr = getVehiclePtr(handle);
        if (!ptr) return -1;
        return Memory.ReadU8(ptr + VEHICLE_CREATED_BY_OFFSET, false);
    }

    function getVehicleSpecialColIndex(handle) {
        if (!isVehicleUsable(handle)) return -1;
        const ptr = getVehiclePtr(handle);
        if (!ptr) return -1;
        return Memory.ReadU8(ptr + VEHICLE_SPECIAL_COL_OFFSET, false);
    }

    function initializeSpecialCollision(handle) {
        if (!isVehicleUsable(handle)) return { ok: false, reason: "vehicle invalid" };

        const ptr = getVehiclePtr(handle);
        if (!ptr) return { ok: false, reason: "vehicle pointer unavailable" };

        const before = Memory.ReadU8(ptr + VEHICLE_SPECIAL_COL_OFFSET, false);
        if (isValidSpecialColIndex(before)) {
            return { ok: true, before, after: before, nativeCalled: false, nativeResult: 1 };
        }

        let nativeResult = 0;
        try {
            // GTA SA 1.0 US: bool CVehicle::GetSpecialColModel() @ 0x6DF3D0.
            // This allocates one of the game's four special collision slots, copies
            // the vehicle collision model into it, and initializes hydraulic data.
            nativeResult = Memory.Fn.ThiscallU8(GET_SPECIAL_COL_MODEL_ADDR, ptr)();
        } catch (e) {
            return { ok: false, before, after: before, nativeCalled: true, nativeResult: 0, reason: "native exception: " + e };
        }

        const after = Memory.ReadU8(ptr + VEHICLE_SPECIAL_COL_OFFSET, false);
        const ok = nativeResult !== 0 && isValidSpecialColIndex(after);
        return {
            ok, before, after, nativeCalled: true, nativeResult,
            reason: ok ? "" : ("GetSpecialColModel failed; return=" + nativeResult + " specialColAfter=" + after)
        };
    }

    function spoofCreatedByAsMission(handle, state) {
        if (!isVehicleUsable(handle)) return { ok: false, reason: "vehicle invalid" };

        const ptr = getVehiclePtr(handle);
        if (!ptr) return { ok: false, reason: "vehicle pointer unavailable" };

        const specialColIndex = Memory.ReadU8(ptr + VEHICLE_SPECIAL_COL_OFFSET, false);
        if (!isValidSpecialColIndex(specialColIndex)) {
            return { ok: false, reason: "invalid specialColIndex=" + specialColIndex, specialColIndex };
        }

        const originalCreatedBy = Memory.ReadU8(ptr + VEHICLE_CREATED_BY_OFFSET, false);
        state.originalCreatedBy = originalCreatedBy;
        state.missionSpoofed = false;

        if (shouldSpoofAsMissionVehicle(originalCreatedBy, specialColIndex)) {
            Memory.WriteU8(ptr + VEHICLE_CREATED_BY_OFFSET, MISSION_VEHICLE, false);
            state.missionSpoofed = true;
        }

        const createdByNow = Memory.ReadU8(ptr + VEHICLE_CREATED_BY_OFFSET, false);
        if (createdByNow !== MISSION_VEHICLE) {
            if (state.missionSpoofed) {
                Memory.WriteU8(ptr + VEHICLE_CREATED_BY_OFFSET, originalCreatedBy, false);
            }
            state.originalCreatedBy = -1;
            state.missionSpoofed = false;
            return { ok: false, reason: "failed to set CreatedBy=2; now=" + createdByNow, specialColIndex };
        }

        return {
            ok: true,
            originalCreatedBy,
            createdByNow,
            specialColIndex,
            changed: state.missionSpoofed
        };
    }

    function restoreCreatedBy(handle, state, reason) {
        if (state.originalCreatedBy < 0) return;

        const originalCreatedBy = state.originalCreatedBy;
        const changed = state.missionSpoofed;
        state.originalCreatedBy = -1;
        state.missionSpoofed = false;

        if (!changed || typeof handle !== "number" || handle <= 0) return;
        const ptr = getVehiclePtr(handle);
        if (!ptr) return;

        Memory.WriteU8(ptr + VEHICLE_CREATED_BY_OFFSET, originalCreatedBy, false);
        const restored = Memory.ReadU8(ptr + VEHICLE_CREATED_BY_OFFSET, false);
        debugLog(
            "CREATEDBY RESTORE handle=" + handle +
            " reason=" + reason +
            " restored=" + restored +
            " expected=" + originalCreatedBy
        );
    }

    function getHorizontalSpeed(handle) {
        if (!isVehicleUsable(handle)) return Infinity;
        const ptr = getVehiclePtr(handle);
        if (!ptr) return Infinity;

        const vx = Memory.ReadFloat(ptr + OFF_MOVE_SPEED + 0x0, false);
        const vy = Memory.ReadFloat(ptr + OFF_MOVE_SPEED + 0x4, false);

        if (!Number.isFinite(vx) || !Number.isFinite(vy)) return Infinity;
        return Math.sqrt(vx * vx + vy * vy);
    }

    function applyHydraulicPattern(handle, pattern) {
        native(
            "CONTROL_CAR_HYDRAULICS",
            handle,
            pattern[0], pattern[1], pattern[2], pattern[3]
        );
    }

    function neutralizeHydraulics(handle) {
        if (!isVehicleUsable(handle)) return;
        applyHydraulicPattern(handle, NEUTRAL_PATTERN);
    }

    function makeState() {
        return {
            stoppedSince: 0,
            requiredStopMs: 0,
            attemptedThisStop: false,
            cooldownUntil: 0,

            armUntil: 0,
            armGangModel: -1,
            armSource: "",
            settleDeadline: 0,
            settleWaitLogged: false,

            bouncing: false,
            gangModel: -1,
            pulsesRemaining: 0,
            phase: "idle",
            patternId: -1,
            currentPattern: NEUTRAL_PATTERN,
            phaseUntil: 0,
            aiHeld: false,
            originalCreatedBy: -1,
            missionSpoofed: false
        };
    }

    function resetStopCycle(state) {
        state.stoppedSince = 0;
        state.requiredStopMs = 0;
        state.attemptedThisStop = false;
    }

    function clearArm(state) {
        state.armUntil = 0;
        state.armGangModel = -1;
        state.armSource = "";
        state.settleDeadline = 0;
        state.settleWaitLogged = false;
    }

    function releaseHeldAi(handle, state, reason) {
        // Restore ownership classification before returning the car to ambient AI.
        restoreCreatedBy(handle, state, reason);

        if (!state.aiHeld) return;
        state.aiHeld = false;

        if (!isVehicleUsable(handle)) return;
        if (getDriver(handle) <= 0) return;

        releaseCarAiAfterHydraulics(native, handle);
        debugLog("AI RELEASE handle=" + handle + " reason=" + reason + " -> CAR_WANDER_RANDOMLY");
    }

    function finishSequence(handle, state, now, reason) {
        if (isVehicleUsable(handle)) {
            neutralizeHydraulics(handle);
        }
        releaseHeldAi(handle, state, reason);

        const wasBouncing = state.bouncing;
        state.bouncing = false;
        state.gangModel = -1;
        state.pulsesRemaining = 0;
        state.phase = "idle";
        state.patternId = -1;
        state.currentPattern = NEUTRAL_PATTERN;
        state.phaseUntil = 0;

        if (wasBouncing) {
            if (reason === "complete") {
                state.cooldownUntil = now + randomInt(COOLDOWN_MIN_MS, COOLDOWN_MAX_MS);
                debugLog("show-off END handle=" + handle);
            } else {
                debugLog("show-off ABORT handle=" + handle + " reason=" + reason);
            }
        }
    }

    function beginPulse(state, now) {
        state.patternId = randomInt(0, 3);
        state.currentPattern = makeRockstarPulsePattern(state.patternId);
        state.phase = "pulse";
        state.phaseUntil = now + PULSE_MS;
    }

    function startSequence(handle, state, gangModel, now, source) {
        if (!isVehicleUsable(handle)) return;
        if (!isHydraulicEligible(!!native("DOES_CAR_HAVE_HYDRAULICS", handle))) return;

        neutralizeHydraulics(handle);

        state.bouncing = true;
        state.gangModel = gangModel;
        state.pulsesRemaining = randomInt(MIN_PULSES, MAX_PULSES);
        beginPulse(state, now);

        debugLog(
            "show-off START handle=" + handle +
            " gangModel=" + gangModel +
            " pulses=" + state.pulsesRemaining +
            " source=" + source +
            " pulseMs=" + PULSE_MS +
            " firstPattern=" + getPulsePatternName(state.patternId)
        );
    }

    function armForSequence(handle, state, gangModel, now, source) {
        if (!isVehicleUsable(handle)) return;
        if (state.bouncing || state.armUntil > 0) return;

        const statusBefore = getVehicleStatus(handle);

        const specialInit = initializeSpecialCollision(handle);
        debugLog(
            "SPECIALCOL INIT handle=" + handle +
            " source=" + source +
            " before=" + specialInit.before +
            " nativeCalled=" + specialInit.nativeCalled +
            " nativeResult=" + specialInit.nativeResult +
            " after=" + specialInit.after +
            " ok=" + specialInit.ok
        );
        if (!specialInit.ok) {
            debugLog(
                "SPECIALCOL INIT REJECT handle=" + handle +
                " source=" + source +
                " reason=" + specialInit.reason
            );
            return;
        }

        const spoof = spoofCreatedByAsMission(handle, state);
        if (!spoof.ok) {
            debugLog(
                "MISSION SPOOF REJECT handle=" + handle +
                " source=" + source +
                " reason=" + spoof.reason
            );
            return;
        }

        holdCarAiForHydraulics(native, handle);
        state.aiHeld = true;
        const statusImmediate = getVehicleStatus(handle);

        neutralizeHydraulics(handle);

        state.armUntil = now + PHYSICS_ARM_DELAY_MS;
        state.armGangModel = gangModel;
        state.armSource = source;
        state.settleDeadline = now + SETTLE_TIMEOUT_MS;
        state.settleWaitLogged = false;

        debugLog(
            "MISSION SPOOF + AI HOLD + PHYSICS ARM handle=" + handle +
            " source=" + source +
            " statusBefore=" + statusBefore +
            " statusImmediate=" + statusImmediate +
            " createdByBefore=" + spoof.originalCreatedBy +
            " createdByNow=" + spoof.createdByNow +
            " specialColBefore=" + specialInit.before +
            " specialColAfter=" + specialInit.after +
            " specialColInitResult=" + specialInit.nativeResult +
            " specialColNativeCalled=" + specialInit.nativeCalled +
            " changed=" + spoof.changed +
            " targetStatus=3 delayMs=" + PHYSICS_ARM_DELAY_MS
        );
    }

    function updateArms(now) {
        for (const [handle, state] of vehicleState.entries()) {
            if (!state.armUntil || now < state.armUntil) continue;

            const gangModelExpected = state.armGangModel;
            const source = state.armSource;

            if (!isVehicleUsable(handle)) {
                clearArm(state);
                restoreCreatedBy(handle, state, "arm target became unusable");
                state.aiHeld = false;
                continue;
            }

            // While waiting for the newly initialized special collision model to
            // settle, keep the exact engine prerequisites that made v1.3 work.
            holdCarAiForHydraulics(native, handle);
            const ptr = getVehiclePtr(handle);
            if (ptr && Memory.ReadU8(ptr + VEHICLE_CREATED_BY_OFFSET, false) !== MISSION_VEHICLE) {
                Memory.WriteU8(ptr + VEHICLE_CREATED_BY_OFFSET, MISSION_VEHICLE, false);
                debugLog("MISSION SPOOF REASSERT handle=" + handle + " phase=settling");
            }

            const status = getVehicleStatus(handle);
            const speed = native("GET_CAR_SPEED", handle);
            const horizontalSpeed = getHorizontalSpeed(handle);
            const gangModel = getGangDriverModel(handle);
            const hasHydraulics = !!native("DOES_CAR_HAVE_HYDRAULICS", handle);
            const onAllWheels = !!native("IS_VEHICLE_ON_ALL_WHEELS", handle);
            const createdBy = getVehicleCreatedBy(handle);
            const specialColIndex = getVehicleSpecialColIndex(handle);

            if (gangModelExpected < 0 || gangModel < 0) {
                clearArm(state);
                releaseHeldAi(handle, state, "arm validation: driver/gang invalid");
                continue;
            }
            if (!hasHydraulics) {
                clearArm(state);
                releaseHeldAi(handle, state, "arm validation: hydraulics missing");
                continue;
            }
            if (!isValidSpecialColIndex(specialColIndex)) {
                clearArm(state);
                releaseHeldAi(handle, state, "arm validation: special collision lost");
                continue;
            }
            if (!Number.isFinite(horizontalSpeed) || horizontalSpeed > HORIZONTAL_MOVE_ABORT_THRESHOLD) {
                clearArm(state);
                releaseHeldAi(handle, state, "arm validation: traffic moving horizontally speed=" + horizontalSpeed);
                continue;
            }

            if (!isSettledForHydraulics(onAllWheels, speed)) {
                if (now >= state.settleDeadline) {
                    debugLog(
                        "SETTLE TIMEOUT handle=" + handle +
                        " source=" + source +
                        " status=" + status +
                        " speed=" + speed +
                        " horizontalSpeed=" + horizontalSpeed +
                        " onAllWheels=" + onAllWheels +
                        " createdBy=" + createdBy +
                        " specialColIndex=" + specialColIndex
                    );
                    clearArm(state);
                    releaseHeldAi(handle, state, "settle timeout");
                    continue;
                }

                if (!state.settleWaitLogged) {
                    state.settleWaitLogged = true;
                    debugLog(
                        "SETTLING handle=" + handle +
                        " source=" + source +
                        " status=" + status +
                        " speed=" + speed +
                        " horizontalSpeed=" + horizontalSpeed +
                        " onAllWheels=" + onAllWheels +
                        " createdBy=" + createdBy +
                        " specialColIndex=" + specialColIndex +
                        " timeoutMs=" + SETTLE_TIMEOUT_MS
                    );
                }
                continue;
            }

            debugLog(
                "SETTLED handle=" + handle +
                " source=" + source +
                " status=" + status +
                " speed=" + speed +
                " horizontalSpeed=" + horizontalSpeed +
                " onAllWheels=" + onAllWheels +
                " gangModel=" + gangModel +
                " createdBy=" + createdBy +
                " specialColIndex=" + specialColIndex
            );

            clearArm(state);
            startSequence(handle, state, gangModel, now, source);
        }
    }

    function updateSequence(handle, state, now) {
        if (!state.bouncing) return;

        if (!isVehicleUsable(handle)) {
            restoreCreatedBy(handle, state, "active target became unusable");
            state.aiHeld = false;
            state.bouncing = false;
            return;
        }

        // Keep normal traffic AI from reclaiming vehicle control
        // during the short Rockstar-style hydraulic sequence.
        holdCarAiForHydraulics(native, handle);

        const ptr = getVehiclePtr(handle);
        if (ptr && Memory.ReadU8(ptr + VEHICLE_CREATED_BY_OFFSET, false) !== MISSION_VEHICLE) {
            Memory.WriteU8(ptr + VEHICLE_CREATED_BY_OFFSET, MISSION_VEHICLE, false);
            debugLog("MISSION SPOOF REASSERT handle=" + handle);
        }

        const horizontalSpeed = getHorizontalSpeed(handle);
        if (!Number.isFinite(horizontalSpeed) || horizontalSpeed > HORIZONTAL_MOVE_ABORT_THRESHOLD) {
            finishSequence(handle, state, now, "traffic moving horizontally speed=" + horizontalSpeed);
            return;
        }

        if (!isHydraulicEligible(!!native("DOES_CAR_HAVE_HYDRAULICS", handle))) {
            finishSequence(handle, state, now, "hydraulics missing");
            return;
        }

        const gangModel = getGangDriverModel(handle);
        if (gangModel < 0) {
            finishSequence(handle, state, now, "driver no longer LS gang");
            return;
        }

        if (state.phase === "pulse") {
            // Rockstar's opponent logic feeds the chosen hydraulic pattern while
            // inside the beat window, then immediately returns all four values to 0.
            applyHydraulicPattern(handle, state.currentPattern);

            if (now < state.phaseUntil) return;

            applyHydraulicPattern(handle, NEUTRAL_PATTERN);
            debugLog(
                "PULSE handle=" + handle +
                " pattern=" + getPulsePatternName(state.patternId) +
                " -> NEUTRAL"
            );

            state.phase = "neutral";
            state.phaseUntil = now + randomInt(NEUTRAL_MIN_MS, NEUTRAL_MAX_MS);
            return;
        }

        // Keep the controls explicitly neutral between pulses.
        applyHydraulicPattern(handle, NEUTRAL_PATTERN);
        if (now < state.phaseUntil) return;

        state.pulsesRemaining--;
        if (state.pulsesRemaining <= 0) {
            finishSequence(handle, state, now, "complete");
            return;
        }

        beginPulse(state, now);
        debugLog(
            "NEXT PULSE handle=" + handle +
            " pattern=" + getPulsePatternName(state.patternId) +
            " remaining=" + state.pulsesRemaining
        );
        applyHydraulicPattern(handle, state.currentPattern);
    }

    function updateActiveSequences(now) {
        for (const [handle, state] of vehicleState.entries()) {
            if (state.bouncing) {
                updateSequence(handle, state, now);
            }
        }
    }

    function isNearby(handle, cjPos) {
        const carPos = native("GET_CAR_COORDINATES", handle);
        if (!carPos || !cjPos) return false;
        return distance2D(carPos, cjPos) <= MAX_DISTANCE_FROM_CJ;
    }

    function processVehicle(handle, cjPos, now) {
        if (!isVehicleUsable(handle)) return;

        let state = vehicleState.get(handle);
        if (!state) {
            state = makeState();
            vehicleState.set(handle, state);
        }

        if (!isNearby(handle, cjPos)) {
            if (state.bouncing) finishSequence(handle, state, now, "too far from CJ");
            clearArm(state);
            releaseHeldAi(handle, state, "too far from CJ");
            return;
        }

        if (!native("IS_CAR_LOW_RIDER", handle)) {
            if (state.bouncing) finishSequence(handle, state, now, "not a lowrider");
            clearArm(state);
            releaseHeldAi(handle, state, "not a lowrider");
            resetStopCycle(state);
            return;
        }

        const gangModel = getGangDriverModel(handle);
        if (gangModel < 0) {
            if (state.bouncing) finishSequence(handle, state, now, "driver no longer LS gang");
            clearArm(state);
            releaseHeldAi(handle, state, "driver no longer LS gang");
            resetStopCycle(state);
            return;
        }

        if (!isHydraulicEligible(!!native("DOES_CAR_HAVE_HYDRAULICS", handle))) {
            if (state.bouncing) finishSequence(handle, state, now, "no existing hydraulics");
            clearArm(state);
            releaseHeldAi(handle, state, "no existing hydraulics");
            resetStopCycle(state);
            return;
        }

        if (state.bouncing || state.armUntil > 0) return;

        const speed = native("GET_CAR_SPEED", handle);
        if (!isStoppedSpeed(speed)) {
            resetStopCycle(state);
            return;
        }

        if (!native("IS_VEHICLE_ON_ALL_WHEELS", handle)) return;

        if (state.stoppedSince === 0) {
            state.stoppedSince = now;
            state.requiredStopMs = randomInt(STOP_MIN_MS, STOP_MAX_MS);
            state.attemptedThisStop = false;
            return;
        }

        if (state.attemptedThisStop) return;
        if (now < state.cooldownUntil) return;
        if ((now - state.stoppedSince) < state.requiredStopMs) return;

        state.attemptedThisStop = true;

        if (Math.random() >= SHOWOFF_CHANCE) {
            debugLog("AUTO roll skipped handle=" + handle + " gangModel=" + gangModel);
            return;
        }

        armForSequence(handle, state, gangModel, now, "AUTO");
    }

    function processAllVehicles(cj, now) {
        const cjPos = native("GET_CHAR_COORDINATES", cj);
        if (!cjPos) return;

        const poolData = readVehiclePool();
        if (!poolData) return;

        const seen = new Set();

        for (let slot = 0; slot < poolData.size; slot++) {
            const poolByte = Memory.ReadU8(poolData.byteMap + slot, false);
            if ((poolByte & 0x80) !== 0) continue;

            const handle = getVehicleHandle(slot, poolByte);
            if (!getVehiclePtr(handle)) continue;

            seen.add(handle);
            processVehicle(handle, cjPos, now);
        }

        for (const handle of vehicleState.keys()) {
            if (!seen.has(handle)) {
                vehicleState.delete(handle);
            }
        }
    }

    function cleanupAllActive(now, reason) {
        for (const [handle, state] of vehicleState.entries()) {
            clearArm(state);
            if (state.bouncing) {
                finishSequence(handle, state, now, reason);
            } else {
                releaseHeldAi(handle, state, reason);
            }
        }
    }

    debugLog(
        "loaded - automatic ambient gang lowrider hydraulics; chance=25%; existing hydraulics only; " +
        "GetSpecialColModel initializes hydraulic collision data; real Rockstar 200ms pulses; " +
        "CreatedBy and AI restored; no fake hop force."
    );

    let lastScanAt = 0;

    while (true) {
        wait(0);

        const now = Date.now();

        if (ONMISSION) {
            cleanupAllActive(now, "mission started");
            continue;
        }

        const cj = native("GET_PLAYER_CHAR", PLAYER_ID);
        if (!cj) {
            cleanupAllActive(now, "CJ unavailable");
            continue;
        }

        updateArms(now);
        updateActiveSequences(now);

        if (!AUTO_TRIGGER_ENABLED) continue;
        if ((now - lastScanAt) < SCAN_INTERVAL_MS) continue;
        lastScanAt = now;

        processAllVehicles(cj, now);
    }
}
