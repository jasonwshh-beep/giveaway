# Kick Keyword Wheel Giveaway

Railway-ready Kick giveaway app.

Viewers enter by typing your chosen keyword in Kick chat. Example: `!duel`, `100`, `left`, etc.

## Pages

- Dashboard: `/`
- OBS wheel overlay: `/overlay`

## Railway variables

Set these in Railway → Variables:

```env
KICK_CHANNEL=yourkickname
ADMIN_PIN=1234
DEFAULT_KEYWORD=!duel
```

Optional if Kick blocks the channel lookup:

```env
KICK_CHATROOM_ID=123456
```

## How to use

1. Deploy to Railway.
2. Open your Railway URL.
3. Set the keyword.
4. Click **Start Giveaway**.
5. Viewers type the keyword in chat.
6. Click **Roll Winner**.
7. The wheel spins for 5 seconds and lands on the winner.

## OBS

Add this as a browser source:

```text
https://YOUR-RAILWAY-URL/overlay
```

## Notes

- One entry per Kick username per giveaway.
- You can hide/show participant count from the dashboard.
- Reset clears the current giveaway pool.
