const { StreamChat } = require("stream-chat");

const streamVideosServer = async (req, res) => {
  const { user_id, API_KEY } = req.body;

  const API_SECRET =
    "k7q35a52x6kwca4tgq3fpg8dcvbkyqkzu46t3aqgsr5mgh64gftdx5mndrme353f";
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
