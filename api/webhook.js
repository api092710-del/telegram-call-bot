const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const axios = require("axios");

exports.config = {
  api: { bodyParser: true },
};

// ===== ENV VALIDATION =====
const requiredEnv = [
  "MONGO_URI",
  "BOT_TOKEN",
  "VAPI_API_KEY",
  "VAPI_ASSISTANT_ID",
  "VAPI_PHONE_ID",
];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`${key} is missing in environment variables`);
  }
});

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
    phone: String,
    otp: String,       // OTP from your website
    status: String,
  });

// ===== VAPI CALL FUNCTION =====
async function callUser(user) {
  try {
    const response = await axios.post(
      "https://api.vapi.ai/call",
      {
        assistantId: process.env.VAPI_ASSISTANT_ID,
        phoneNumberId: process.env.VAPI_PHONE_ID,
        customer: {
          number: user.phone,
        },
        assistantOverrides: {
          variableValues: {
            otp: user.otp,   // Pass website OTP to AI
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("VAPI CALL SUCCESS:", response.data);
  } catch (error) {
    console.error("VAPI ERROR:", error.response?.data || error.message);
    throw error;
  }
}

// ===== MAIN HANDLER =====
module.exports = async function handler(req, res) {
  await connectDB();
  const bot = getBot();
  const body = req.body;

  // ===== TELEGRAM MESSAGE HANDLER =====
  if (body?.message) {
    const chatId = body.message.chat.id;
    const text = body.message.text?.trim();

    if (!text) return res.status(200).send("OK");

    // START COMMAND
    if (text === "/start") {
      await User.deleteOne({ chatId });

      await bot.sendMessage(
        chatId,
        "Welcome 👋\n\nSend your phone number (+countrycode).\nExample: +61363165719"
      );

      await new User({ chatId, status: "phone" }).save();
      return res.status(200).send("OK");
    }

    const user = await User.findOne({ chatId });
    if (!user) return res.status(200).send("OK");

    // PHONE STEP
    if (user.status === "phone") {
      const cleanedPhone = text.replace(/\s+/g, "");

      user.phone = cleanedPhone;

      // IMPORTANT:
      // Here you must fetch OTP from YOUR WEBSITE database.
      // Replace this dummy value with real fetch logic.
      user.otp = "123456";  // <-- Replace with real website OTP

      user.status = "calling";
      await user.save();

      await bot.sendMessage(chatId, "📞 Calling now...");
      await callUser(user);

      return res.status(200).send("OK");
    }
  }

  // ===== VAPI DTMF HANDLER =====
  if (body?.dtmf) {
    const phone = body.customer?.number;
    const digits = body.dtmf;

    const user = await User.findOne({ phone });
    if (!user) return res.status(200).send("OK");

    if (digits === user.otp) {
      user.status = "verified";
      await user.save();

      await bot.sendMessage(
        user.chatId,
        "✅ OTP Verified\nYour request has been successfully confirmed."
      );
    } else {
      await bot.sendMessage(user.chatId, "❌ Incorrect OTP entered.");
    }
  }

  return res.status(200).send("OK");
};
