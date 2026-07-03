# Kick Keyword Wheel Giveaway — Growing Wheel

## What changed
- The visible wheel fills/grows as entries come in.
- New entrants trigger a small pulse and appear on the wheel.
- The compact OBS overlay still has Giveaway Wheel + keyword above the wheel.
- The app no longer crashes on 403. It shows the 403 as a chat connection error.

## Railway variables

```env
KICK_CHANNEL=yourkickname
ADMIN_PIN=1234
DEFAULT_KEYWORD=!join
```

## Important about 403
If the dashboard says `Kick returned 403 Forbidden`, that means Kick is blocking Railway from reading the public Kick endpoint. The app itself is running, but chat entries will not be received until the Kick chat connection is allowed.

This is a Kick/Railway blocking issue, not an OBS or overlay issue.
