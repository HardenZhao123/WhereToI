import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

/**
 * Service to handle AI-powered summarization of toilet comments using Google Gemini.
 */
export async function createAiService({
  apiKey = process.env.GOOGLE_AI_API_KEY,
  modelName = "gemini-1.5-flash"
} = {}) {
  if (!apiKey) {
    console.warn("GOOGLE_AI_API_KEY is not set. AI summarization will be disabled.");
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
    ]
  });

  return {
    /**
     * Summarizes an array of comment objects.
     * @param {Array} comments - Array of comment objects with 'comment_text' property.
     * @returns {Promise<string>} The generated summary.
     */
    async summarizeComments(comments) {
      if (!comments || comments.length === 0) {
        return "No comments available to summarize.";
      }

      const commentsText = comments
        .map((c, i) => `${i + 1}. ${c.comment_text}`)
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

      try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        if (!text) {
          throw new Error("AI returned an empty response.");
        }
        
        return text.trim();
      } catch (error) {
        // Log detailed error for debugging
        console.error("Gemini API Error Detail:", {
          message: error.message,
          stack: error.stack,
          commentsCount: comments.length
        });
        throw error;
      }
    }
  };
}
