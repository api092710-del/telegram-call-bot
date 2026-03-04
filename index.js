require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");

// ================= INIT =================

const bot = new TelegramBot(process.env.BOT_TOKEN);
const app = express();

app.use(express.json());

// ================= DATABASE =================

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("❌ MongoDB connection failed:");
    console.error(err);
    process.exit(1);
  });

// ================= MODEL =================

const User = mongoose.model("User", {
  chatId: String,

  titleName: String, // Mr Krishna / Mrs Karisma
  category: String,
  phone: String,

  status: String,
  otp: String
});

// ================= /START =================

bot.onText(/\/start/, async (msg) => {

  await User.deleteOne({ chatId: msg.chat.id });

  const user = new User({
    chatId: msg.chat.id,
    status: "name"
  });

  await user.save();

  bot.sendMessage(msg.chat.id,
`Welcome 👋

Please enter your title + name.

Example:
Mr Krishna
Mrs Karisma`
  );
});

// ================= MAIN HANDLER =================

bot.on("message", async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) return;
  if (text === "/start") return;

  const user = await User.findOne({ chatId });
  if (!user) return;

  // ===== TITLE + NAME =====
  if (user.status === "name") {

    if (!text.match(/^(Mr|Mrs|Ms)\s/i)) {

      bot.sendMessage(chatId,
        "❌ Please start with Mr / Mrs / Ms\nExample: Mr Krishna"
      );

      return;
    }

    user.titleName = text;
    user.status = "category";

    await user.save();

    bot.sendMessage(chatId,
`Nice to meet you ${user.titleName} 😊

Enter your category:`
    );

    return;
  }

  // ===== CATEGORY =====
  if (user.status === "category") {

    user.category = text;
    user.status = "phone";

    await user.save();

    bot.sendMessage(chatId,
`Send your phone number
(+CountryCodeNumber)`
    );

    return;
  }

  // ===== PHONE =====
  if (user.status === "phone") {

    if (!text.startsWith("+")) {

      bot.sendMessage(chatId,
        "❌ Use international format\nExample: +614xxxxxxxx"
      );

      return;
    }

    user.phone = text;
    user.status = "calling";

    await user.save();

    bot.sendMessage(chatId,"📞 Calling now...");

    await callUser(user);

    return;
  }

  // ===== OTP FROM TELEGRAM =====
  if (user.status === "otp") {

    if (text === user.otp) {

      user.status = "verified";
      await user.save();

      bot.sendMessage(chatId,
`✅ Verified!

Thank you ${user.titleName}.
Your request will be processed soon.
Have a nice day 🌟`
      );

    } else {

      bot.sendMessage(chatId,"❌ Wrong OTP");

    }
  }

});

// ================= CALL FUNCTION =================

async function callUser(user){

  try {

    await axios.post(
      "https://api.ringg.ai/v1/calls",
      {
        phone: user.phone,

        assistant_id: "69c16290-66af-426c-832f-3681e482a88b",

        metadata: {
          name: user.titleName,
          category: user.category
        },

        country_code: "AU"
      },
      {
        headers: {
          "X-API-KEY": process.env.RINGG_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Calling:", user.phone);

  } catch (err){

    console.error("Call Error:", err.response?.data || err.message);

  }
}

// ================= TELEGRAM WEBHOOK =================

app.post("/webhook", (req, res) => {

  bot.processUpdate(req.body);
  res.sendStatus(200);

});

// ================= RINGG WEBHOOK =================

app.post("/ringg-webhook", async (req,res)=>{

  const { phone, step, intent, digits, status } = req.body;

  console.log("Ringg:", req.body);

  const user = await User.findOne({ phone });
  if (!user) return res.send("OK");

  // ===== CALL STATUS =====

  if (status === "ringing") {
    bot.sendMessage(user.chatId,"📞 Ringing...");
  }

  if (status === "picked") {
    bot.sendMessage(user.chatId,"☎️ Call answered");
  }

  if (status === "ended") {
    bot.sendMessage(user.chatId,"📴 Call ended");
  }

  // ===== STEP 2: SECURITY QUESTION =====

  if (step === "confirm_request" && intent === "no") {

    const otp = Math.floor(100000 + Math.random()*900000).toString();

    user.otp = otp;
    user.status = "otp";

    await user.save();

    bot.sendMessage(user.chatId,
`🔐 Verification Code: ${otp}

Enter it here in Telegram.`
    );
  }

  // ===== OTP FROM CALL (DTMF) =====

  if (step === "otp_step" && digits) {

    bot.sendMessage(user.chatId,
      `📲 OTP entered on call: ${digits}`
    );
  }

  res.send("OK");
});

// ================= SERVER =================

app.listen(3000, ()=>{

  console.log("Server running on port 3000");

});
