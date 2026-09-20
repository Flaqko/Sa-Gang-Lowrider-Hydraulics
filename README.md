# Gang Lowrider Hydraulics v1.0

Ambient lowrider hydraulic show-offs for **GTA San Andreas Classic 1.0 US + CLEO Redux**.

When an eligible Los Santos gang lowrider sits stopped in traffic, the driver can occasionally show off with genuine GTA SA hydraulic movements. The mod uses the game's own hydraulic collision setup and `CONTROL_CAR_HYDRAULICS` behavior rather than applying fake upward vehicle force.

## Behavior

- **25% chance** after an eligible traffic stop.
- Car must remain stopped for a random **2.5–4.0 seconds**.
- Performs **3–6** hydraulic pulses.
- Each pulse uses Rockstar-style **200 ms** hydraulic input followed by neutral.
- Random motion patterns:
  - front axle
  - rear axle
  - front-left
  - front-right
- **25–40 second per-car cooldown** after a completed show-off.
- Disabled during missions.
- Nearby scan range: 90 m.

## Eligible gangs

Los Santos gangs only:

- Ballas — models 102–104
- Grove Street Families — models 105–107
- Los Santos Vagos — models 108–110
- Varrio Los Aztecas — models 114–116

## Vehicle requirements

- Must be a GTA lowrider (`IS_CAR_LOW_RIDER`).
- Must **already have hydraulics**.
- This mod does **not** install, add, or remove hydraulic upgrade 1087.

## How it works

Ambient traffic lowriders normally lack the special collision data required by GTA SA's hydraulic physics. When needed, the mod calls GTA's own `CVehicle::GetSpecialColModel()` routine to initialize that data. During the short show-off sequence the vehicle is temporarily placed into the engine state needed for hydraulic processing, then its original ownership classification and normal wandering traffic AI are restored afterward.

The special collision slot remains attached to the vehicle and is managed by GTA's normal vehicle lifetime handling.

## Installation

Place:

`GangLowriderHydraulics_v1.0[mem].js`

in your GTA San Andreas `CLEO` directory.

Remove any older Gang Lowrider Hydraulics test build first.

Keep **`[mem]`** in the filename. The script uses GTA SA 1.0 US memory structures and native function addresses.

## Notes

- No cheat flag is set.
- No fake `APPLY_FORCE_TO_CAR` hopping is used.
- Release debug logging is disabled.
- The F6 diagnostic hotkey from test builds has been removed.
