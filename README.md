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


## Clean overlay update

This version removes the two bottom boxes below the wheel, changes the keyword line to:

`Type [keyword] in chat`

and fixes the wheel graphics so entries are equal-size symmetrical slices.


## Horizontal overlay update

The OBS overlay is now 760×390 with giveaway information on the left and the wheel on the right.

Suggested OBS Browser Source size:

```text
760 x 390
```

or scale proportionally to:

```text
900 x 462
```


## Compact spinner overlay update

The overlay is now a small 430×132 horizontal card inspired by the supplied reference layout.

- Keyword appears along the bottom.
- During a roll, participant names animate left-to-right through a slot-style spinner for 5 seconds.
- The spinner stops on the server-selected winner.
- After the roll, the card shows the current winner.

Suggested OBS Browser Source size:

```text
430 x 132
```

For a slightly larger display, scale proportionally.
