import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

/**
 * Service to handle AI-powered summarization of toilet comments using Google Gemini.
 */
export async function createAiService({
  apiKey = process.env.GOOGLE_AI_API_KEY,
  modelName = "gemini-1.5-flash"
} = {}) {
  if (!apiKey || apiKey.trim().length === 0) {
    console.warn("GOOGLE_AI_API_KEY is not set or empty. AI summarization will be disabled.");
    return null;
  }

  const cleanApiKey = apiKey.trim();
  const genAI = new GoogleGenerativeAI(cleanApiKey);
  
  // List of models to try in order of preference. 
  // We include 'lite' models as they are most likely to have free quota in 2026.
  const modelsToTry = [
    "gemini-2.0-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-flash-lite-latest",
    "gemini-pro-latest"
  ];

  return {
    async summarizeComments(comments) {
      if (!comments || comments.length === 0) {
        return "No comments available to summarize.";
      }

      const writtenComments = comments
        .map((comment) => String(comment?.comment_text ?? "").trim())
        .filter(Boolean);

      if (writtenComments.length === 0) {
        return "No written comments available to summarize.";
      }

      const commentsText = writtenComments
        .map((commentText, i) => `${i + 1}. ${commentText}`)
        .join("\n");

      const prompt = `
        You are an assistant for "WhereToI", a web app helping people find clean and accessible toilets.
        Below is a list of user feedback for a specific public toilet. 
        Please provide a concise summary (max 3-4 sentences) highlighting:
        1. General cleanliness and maintenance.
        2. Accessibility or specific features mentioned.
        3. Any repeated complaints or praises.
        
        Keep the tone helpful and objective.
        
        User Feedback:
        ${commentsText}
        
        Summary:
      `;

      let lastError = null;

      for (const modelId of modelsToTry) {
        try {
          const model = genAI.getGenerativeModel({
            model: modelId,
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
            ]
          });

          const result = await model.generateContent(prompt);
          const response = await result.response;
          const text = response.text();
          
          if (text) {
            return text.trim();
          }
        } catch (error) {
          lastError = error;
          const errorMessage = error.message?.toLowerCase() || "";
          
          // If it's a 404 (not found) or 429 (quota/limit 0), we try the next model.
          if (
            errorMessage.includes("404") || 
            errorMessage.includes("not found") || 
            errorMessage.includes("429") || 
            errorMessage.includes("quota")
          ) {
            console.warn(`Model ${modelId} failed (${error.status || "Error"}), trying next...`);
            continue;
          }
          // For other errors (like auth), we stop immediately
          break;
        }
      }

      // If we get here, all models failed
      console.error("Gemini API Error Detail:", {
        message: lastError.message,
        stack: lastError.stack,
        commentsCount: comments.length
      });
      throw lastError;
    }
  };
}
