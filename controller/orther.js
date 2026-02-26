const { StreamChat } = require("stream-chat");

const streamVideosServer = async (req, res) => {
  const { user_id, API_KEY } = req.body;

  const API_SECRET =
    "f2c5eup4zn4bfhm7epekzq4z9v5bucunk59anshe9w6ysr8mz6ph9acufund82pv";
  const serverClient = StreamChat.getInstance(API_KEY, API_SECRET);
  try {
    const userToken = serverClient.createToken(user_id);
    res.json({ token: userToken });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ error: "Error generating token" });
  }
};

module.exports = {
  streamVideosServer,
};
