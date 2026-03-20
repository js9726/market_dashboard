import { useUser } from "@clerk/nextjs";
import UserProfile from "./UserProfile";

const ChatInterface: React.FC = () => {
  const { user, isLoaded } = useUser();
  const [messages, setMessages] = useState<Message[]>([]);
  // ... existing state

  // Add user ID to API requests
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !user) return;

    const userMessage = input.trim();
    setInput('');
    
    setMessages(prev => [...prev, { text: userMessage, isUser: true }]);
    setIsLoading(true);

    try {
      const tickerRegex = /\$([A-Za-z]+)/g;
      const tickers = Array.from(userMessage.matchAll(tickerRegex)).map(match => match[1]);
      
      if (tickers.length > 0) {
        const response = await fetch('/api/analysis', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tickers,
            userId: user.id, // Add user ID to requests
            end_date: new Date().toISOString().split('T')[0],
          }),
        });
        // ... rest of the code
      }
    } catch (error) {
      // ... error handling
    }
  };

  if (!isLoaded) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <h1 className="text-2xl mb-4">Please sign in to use the chatbot</h1>
        <a href="/sign-in" className="text-blue-500 hover:underline">Sign In</a>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
      <div className="mb-4">
        <UserProfile />
      </div>
      <div className="flex-1 overflow-y-auto mb-4 space-y-4">
        {messages.map((msg, idx) => (
          <ChatMessage key={idx} message={msg.text} isUser={msg.isUser} />
        ))}
        <div ref={messagesEndRef} />
      </div>
      {/* ... rest of your component */}
    </div>
  );
}; 