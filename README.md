# Kick Keyword Wheel Giveaway — Compact Fixed

Railway-ready giveaway bot for Kick.

## Features
- Type a keyword in the dashboard.
- Viewers enter by typing the keyword in Kick chat.
- One entry per username.
- Option to hide participant count.
- Roll button starts a 5-second wheel animation.
- Overlay is compact and modern for OBS.
- Purple/white theme.

## Railway Variables

Set these in Railway:

```env
KICK_CHANNEL=yourkickname
ADMIN_PIN=1234
DEFAULT_KEYWORD=!join
```

Do not include `kick.com/` or `@` in `KICK_CHANNEL`.

## Pages

Dashboard:

```text
/
```

OBS overlay:

```text
/overlay
```

## Important fix

This version fixes:

```text
Pusher is not a constructor
```

by safely loading the constructor using:

```js
const PusherImport = require("pusher-js");
const Pusher = PusherImport.default || PusherImport;
```

## OBS recommendation

Use the `/overlay` URL as a Browser Source.

Suggested size:

```text
500 x 650
```

or:

```text
450 x 600
```
