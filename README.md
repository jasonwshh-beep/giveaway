# Kick Keyword Wheel Giveaway — Vote Bot Chat Method

This version uses the same low-level WebSocket/Pusher chat method as the working `!vote 1 / !vote 2` bot.

## Railway variables

```env
KICK_CHANNEL=yourkickname
ADMIN_PIN=1234
DEFAULT_KEYWORD=!join
KICK_CHATROOM_ID=
```

Do not include `@` or `kick.com/` in `KICK_CHANNEL`.

## Important

If Railway still cannot resolve the channel, set `KICK_CHATROOM_ID` manually. This is the same fallback the vote bot supports.

## URLs

Dashboard:

```text
/
```

OBS overlay:

```text
/overlay
```

Suggested OBS Browser Source size:

```text
450 x 600
```

or

```text
500 x 650
```

## Features

- Tracks people who type your keyword.
- One entry per username.
- Visible wheel grows/fills with entries as they come in.
- Optional hidden participant count.
- 5-second wheel animation.
- Purple/white compact overlay.
