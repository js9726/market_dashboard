import { auth } from "@clerk/nextjs";

export async function POST(request: Request) {
  try {
    const { userId } = auth();
    
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    console.log('\n=== API Request ===');
    console.log('User ID:', userId);
    console.log('Received request body:', JSON.stringify(body, null, 2));

    // ... rest of your API route code
  } catch (error) {
    // ... error handling
  }
} 