import { GoogleGenAI, Type } from "@google/genai";
import { GeminiRecommendation } from "../types";

// Initialize Gemini
// NOTE: In a real production app, API keys should be proxied via backend.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getAIRecommendations = async (favorites: string[]): Promise<GeminiRecommendation[]> => {
  if (!process.env.API_KEY) {
    console.warn("No Gemini API Key found");
    return [
      { title: "One Piece", reason: "Because you haven't configured the API key yet!" },
      { title: "Naruto", reason: "A classic starter anime." }
    ];
  }

  if (favorites.length === 0) {
    return [
      { title: "Attack on Titan", reason: "It is a universally acclaimed masterpiece." },
      { title: "Fullmetal Alchemist: Brotherhood", reason: "Essential viewing for any anime fan." }
    ];
  }

  try {
    const model = "gemini-2.5-flash";
    const prompt = `
      Based on the following anime list that a user likes: ${favorites.join(", ")}.
      Recommend 5 other anime they might enjoy.
      Provide the output strictly as a JSON array of objects with 'title' and 'reason' keys.
      Do not include the anime already in the list.
    `;

    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              reason: { type: Type.STRING },
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    return JSON.parse(text) as GeminiRecommendation[];
  } catch (error) {
    console.error("Gemini Recommendation Error:", error);
    return [];
  }
};