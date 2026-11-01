---
status: accepted
---

# The Lock is repeated turn-off, in a separate Homey Pro app with its own SSAP client

LG webOS has no SSAP call that locks the TV or disables the remote, and a lock app on the TV cannot sit on top of other apps without rooting. **The Lock** is therefore that the service turns the TV off (`turnOff`) every time it sees the TV on while the Quota is used up. The service is a separate Homey Pro app that talks SSAP directly to the TV (wss, port 3001), not a set of Flows or an existing LG app.

## Considered Options

- **Flows + existing LG app:** minute flows skip and arrive in bursts, delayed cards are lost on restart, and the LG apps lack reliable power state or are poorly maintained.
- **Hybrid (LG app for status and the turn-off command + own counter app):** inherits the LG apps' faults.
- **Raspberry Pi with aiowebostv:** the most deterministic, but one more device to maintain, and Homey is the control panel anyway. The logic can be moved there later.
- **Rooting + Homebrew Channel for a real lock on the TV:** unofficial and risky, and not needed for the target group (children under about 13).

## Consequences

- The children see a picture for a few seconds each time the TV is switched on while the Lock is engaged, and the remote cannot be prevented from turning the TV on.
- Unlocking and "on" need Wake-on-LAN, and "LG Connect Apps" must be turned on.
- Counting uses its own timestamps and treats lost contact as "TV off", so a lost tick or a Homey restart costs a few minutes at most.
