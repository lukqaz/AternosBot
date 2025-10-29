const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const express = require('express');
const config = require('./settings.json');

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

app.listen(5000, () => {
  console.log('Server started on port 5000');
});

function createBot() {
  const bot = mineflayer.createBot({
    username: config['bot-account']['username'],
    password: config['bot-account']['password'],
    auth: config['bot-account']['type'],
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
  });

  bot.loadPlugin(pathfinder);
  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  bot.settings.colorsEnabled = false;

  let pendingPromise = Promise.resolve();

  // --- AUTH MODULE ---
  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/register ${password} ${password}`);
      console.log(`[Auth] Sent /register command.`);

      bot.once('messagestr', (message) => {
        console.log(`[ChatLog] ${message}`);
        if (message.includes('successfully registered')) {
          console.log('[INFO] Registration confirmed.');
          resolve();
        } else if (message.includes('already registered')) {
          console.log('[INFO] Bot was already registered.');
          resolve();
        } else {
          reject(`[Auth] Unexpected register message: "${message}"`);
        }
      });
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/login ${password}`);
      console.log(`[Auth] Sent /login command.`);

      bot.once('messagestr', (message) => {
        console.log(`[ChatLog] ${message}`);
        if (message.includes('successfully logged in')) {
          console.log('[INFO] Login successful.');
          resolve();
        } else {
          reject(`[Auth] Unexpected login message: "${message}"`);
        }
      });
    });
  }

  // --- ON SPAWN ---
  bot.once('spawn', () => {
    console.log('\x1b[33m[AfkBot] Bot joined the server\x1b[0m');

    // Auto-Auth
    if (config.utils['auto-auth'].enabled) {
      console.log('[INFO] Started auto-auth module');
      const password = config.utils['auto-auth'].password;
      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch((error) => console.error('[ERROR]', error));
    }

    // Chat Messages
    if (config.utils['chat-messages'].enabled) {
      console.log('[INFO] Started chat-messages module');
      const messages = config.utils['chat-messages']['messages'];

      if (config.utils['chat-messages'].repeat) {
        const delay = config.utils['chat-messages']['repeat-delay'];
        let i = 0;

        setInterval(() => {
          bot.chat(`${messages[i]}`);
          i = (i + 1) % messages.length;
        }, delay * 1000);
      } else {
        messages.forEach((msg) => bot.chat(msg));
      }
    }

    // Move to Position
    const pos = config.position;
    if (pos.enabled) {
      console.log(`\x1b[32m[AfkBot] Moving to (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    // --- ADVANCED ANTI-AFK ---
    if (config.utils['anti-afk'].enabled) {
      console.log('[INFO] Started advanced anti-AFK module.');

      const startPos = bot.entity.position.clone();

      async function randomMove() {
        try {
          const directions = ['forward', 'back', 'left', 'right'];
          const dir = directions[Math.floor(Math.random() * directions.length)];
          const duration = 500 + Math.random() * 1000;

          bot.setControlState(dir, true);
          await new Promise(r => setTimeout(r, duration));
          bot.setControlState(dir, false);

          // Kamera leicht drehen
          if (Math.random() < 0.6) {
            const yawChange = (Math.random() - 0.5) * Math.PI / 2; // ±90°
            bot.look(bot.entity.yaw + yawChange, bot.entity.pitch, true);
          }

          // Gelegentlich springen/sneaken
          if (Math.random() < 0.2) {
            bot.setControlState('jump', true);
            await new Promise(r => setTimeout(r, 300));
            bot.setControlState('jump', false);
          }
          if (config.utils['anti-afk'].sneak && Math.random() < 0.1) {
            bot.setControlState('sneak', true);
            await new Promise(r => setTimeout(r, 500));
            bot.setControlState('sneak', false);
          }

          // Pause zwischen Bewegungen
          const pause = 5000 + Math.random() * 10000;
          setTimeout(randomMove, pause);
        } catch (err) {
          console.log('[Anti-AFK ERROR]', err.message);
        }
      }

      setTimeout(randomMove, 5000);

      // Zurück zur Startposition, falls zu weit entfernt
      setInterval(() => {
        const distance = bot.entity.position.distanceTo(startPos);
        if (distance > 3) {
          bot.pathfinder.setGoal(new GoalBlock(
            Math.floor(startPos.x),
            Math.floor(startPos.y),
            Math.floor(startPos.z)
          ));
          console.log('[Anti-AFK] Returning to start position.');
        }
      }, 300000); // alle 5 Minuten
    }
  });

  // --- EVENTS ---
  bot.on('goal_reached', () => {
    console.log(`\x1b[32m[AfkBot] Arrived at target location ${bot.entity.position}\x1b[0m`);
  });

  bot.on('death', () => {
    console.log(`\x1b[33m[AfkBot] Bot died, respawned at ${bot.entity.position}\x1b[0m`);
  });

  // --- AUTO RECONNECT ---
  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      console.log('[INFO] Bot disconnected. Reconnecting soon...');
      setTimeout(() => {
        createBot();
      }, config.utils['auto-reconnect-delay'] || 5000);
    });
  }

  bot.on('kicked', (reason) => {
    console.log('\x1b[33m', `[AfkBot] Kicked from server. Reason:\n${reason}`, '\x1b[0m');
  });

  bot.on('error', (err) => {
    console.log(`\x1b[31m[ERROR] ${err.message}\x1b[0m`);
    if (err.message.includes('ECONNRESET') || err.message.includes('ECONNREFUSED')) {
      console.log('\x1b[31m[INFO] Server offline or unreachable.\x1b[0m');
      console.log('\x1b[31m[INFO] If using Aternos, start the server first.\x1b[0m');
    }
  });
}

createBot();
