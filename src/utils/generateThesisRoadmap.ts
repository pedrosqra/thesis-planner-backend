import axios, { AxiosError } from 'axios';
import dotenv from "dotenv";
import { PromptGenerator } from "./../utils/promptGenerator";
// import * as dirtyJson from 'dirty-json'; // Optional: For more aggressive cleaning

dotenv.config();

// --- Configuration ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Keep if used elsewhere, otherwise remove
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Ensure this is set in your .env
const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper/search";
const OPENALEX_API = "https://api.openalex.org/works";
const CORE_API = "https://api.core.ac.uk/v3/search/works";
const CORE_API_KEY = process.env.CORE_API_KEY || "YOUR_CORE_API_KEY"; // Replace or load from env
const MAX_RESULTS = 10;

if (!GOOGLE_API_KEY) {
    console.error("FATAL ERROR: GOOGLE_API_KEY is not defined in environment variables.");
    process.exit(1); // Exit if essential keys are missing
}

// --- Interfaces ---
interface ResearchPaper {
  title: string;
  url: string;
  paperLink: string;
  abstract: string;
  citationCount: number;
  authors: string;
}

// Define expected structure for the final roadmap sent to frontend
interface ThesisRoadmapOutput {
    thesisDescription: string;
    stepByStep: any[] | null; // Expecting an array of step objects
    relatedPapers: any[] | null; // Expecting an array of ranked paper objects
    methodology: Record<string, any> | null; // Expecting a methodology object
    researchGapAnalysis: Record<string, any> | null; // Expecting a gaps object
    prosAndCons: Record<string, any> | null; // Expecting a pros/cons object
    error?: string; // Optional error message
}

// Define the structure for a provider entry
interface PaperProvider {
    name: string;
    fetchFunction: (query: string) => Promise<ResearchPaper[]>;
}

// --- Robust JSON Parsing Helper ---

/**
 * Extracts JSON from a string potentially wrapped in markdown fences
 * and attempts to parse it, with cleaning for common LLM errors.
 * @param rawString The raw string response from the LLM.
 * @param context A description of what is being parsed (for logging).
 * @returns The parsed JavaScript object/array, or null if parsing fails.
 */
const extractAndParseJson = <T = any>(rawString: string | undefined | null, context: string): T | null => {
    if (!rawString) {
        console.warn(`[Parser] No raw string provided for context: ${context}`);
        return null;
    }

    let jsonString = rawString
        .replace(/^```json\s*/im, '') // Remove starting fence (case-insensitive, multiline)
        .replace(/\s*```$/im, '')    // Remove ending fence (case-insensitive, multiline)
        .trim(); // Remove leading/trailing whitespace

    // Handle cases where the LLM might just return plain text without fences but intended JSON
    if (!jsonString.startsWith('[') && !jsonString.startsWith('{')) {
         // Basic check: If it doesn't look like JSON start, maybe it's an error message?
         if (jsonString.length < 200 && (jsonString.includes('error') || jsonString.includes('sorry'))) {
             console.warn(`[Parser] Raw string for ${context} looks like plain text/error, not JSON: "${jsonString.substring(0,100)}..."`);
             // Decide how to handle: return null, or return an error object?
             // Returning null for now, let the main function decide.
             return null;
         }
         // Otherwise, proceed cautiously, maybe it's valid JSON without fences
    }

    try {
        // First attempt: Parse directly
        return JSON.parse(jsonString) as T;
    } catch (initialError: any) {
        console.warn(`[Parser] Initial JSON.parse failed for ${context}. Attempting cleaning. Error: ${initialError.message}`);
        // console.log(`[Parser] String causing initial error (first 500 chars): ${jsonString.substring(0, 500)}`); // Optional: Log problematic string

        // Attempt basic cleaning (most common issue: unescaped newlines)
        try {
            // Replace literal newlines \n with escaped \\n ONLY IF they are likely within strings
            // This is a heuristic and might not be perfect.
            // It looks for patterns like "...\n..." and replaces \n with \\n.
            // Caution: More complex regex might be needed for edge cases (e.g., newlines in keys?).
             const cleanedString = jsonString.replace(/:\s*"((\\"|[^"])*?)"/g, (match, group1) => {
                 // Inside the captured string value (group1), replace \n with \\n
                 const repairedValue = group1.replace(/(?<!\\)\n/g, '\\n');
                 return `: "${repairedValue}"`;
             }).replace(/:\s*'([^']*)'/g, (match, group1) => { // Handle single quotes if LLM uses them
                 const repairedValue = group1.replace(/(?<!\\)\n/g, '\\n');
                 return `: '${repairedValue}'`; // Keep single quotes if originally used
             });

            // If the string looks different after cleaning, log it
             if (cleanedString !== jsonString) {
                 console.log(`[Parser] Attempting parse after newline cleaning for ${context}.`);
                 // console.log(`[Parser] Cleaned string slice: ${cleanedString.substring(0, 500)}`);
             } else {
                 console.warn(`[Parser] Newline cleaning did not modify the string for ${context}. The error might be different.`);
             }


            return JSON.parse(cleanedString) as T;
        } catch (cleaningError: any) {
            console.error(`[Parser] JSON.parse failed even after cleaning for ${context}. Error: ${cleaningError.message}`);
            console.error(`[Parser] Final problematic string slice for ${context}: ${jsonString.substring(0, 500)}`);

            // --- Optional: More Aggressive Cleaning (using dirty-json) ---
            /*
            try {
                console.warn(`[Parser] Attempting parsing with dirty-json for ${context}...`);
                // dirty-json tries to fix many common JSON errors
                return dirtyJson.parse(jsonString);
            } catch (dirtyError: any) {
                 console.error(`[Parser] dirty-json also failed for ${context}: ${dirtyError.message}`);
                 return null; // Give up
            }
            */
            // --- End Optional ---

            return null; // Give up after basic cleaning
        }
    }
};


// --- Main Function ---

/**
 * Generates a complete thesis roadmap using AI & research paper APIs.
 * @param {string} thesisDescription - The user's thesis topic or idea.
 * @returns {Promise<ThesisRoadmapOutput>} - A structured roadmap with steps, related papers, methodology, etc.
 */
export const generateThesisRoadmap = async (thesisDescription: string): Promise<ThesisRoadmapOutput> => {
    let stepByStepRaw: string | null = null;
    let rankedPapersRaw: string | null = null;
    let methodologyRaw: string | null = null;
    let researchGapAnalysisRaw: string | null = null;
    let prosAndConsRaw: string | null = null;
    let relatedPapers: ResearchPaper[] = []; // Store papers fetched from APIs

    try {
        // 🔹 1️⃣ Generate Step-by-Step Guide (LLM) - Get Raw String
        stepByStepRaw = await callGemini(PromptGenerator.stepByStep(thesisDescription), "step-by-step guide");

        // 🔹 2️⃣ Fetch Related Papers (API Calls)
        relatedPapers = await fetchRelatedPapers(thesisDescription);

        // 🔹 3️⃣ Summarize & Rank Papers (LLM) - Get Raw String
        rankedPapersRaw = await rankAndSummarizePapersLLM(thesisDescription, relatedPapers);

        // 🔹 4️⃣ Generate Detailed Methodology (LLM) - Get Raw String
        methodologyRaw = await callGemini(PromptGenerator.methodology(thesisDescription), "methodology");

        // 🔹 5️⃣ Generate Research Gap Analysis (LLM) - Get Raw String
        researchGapAnalysisRaw = await generateResearchGapAnalysisLLM(relatedPapers, thesisDescription);

        // 🔹 6️⃣ Generate Pros & Cons (LLM) - Get Raw String
        prosAndConsRaw = await generateProsAndConsLLM(relatedPapers, thesisDescription);

        // 🔹 7️⃣ Parse all Raw Strings
        console.log("--- Parsing LLM Responses ---");
        const parsedStepByStep = extractAndParseJson<any[]>(stepByStepRaw, "stepByStep");
        const parsedRankedPapers = extractAndParseJson<any[]>(rankedPapersRaw, "relatedPapers (ranked)");
        const parsedMethodology = extractAndParseJson<Record<string, any>>(methodologyRaw, "methodology");
        const parsedResearchGaps = extractAndParseJson<Record<string, any>>(researchGapAnalysisRaw, "researchGapAnalysis");
        const parsedProsCons = extractAndParseJson<Record<string, any>>(prosAndConsRaw, "prosAndCons");
        console.log("--- Parsing Complete ---");

        // Check if any critical parsing failed
        if (!parsedStepByStep || !parsedRankedPapers || !parsedMethodology || !parsedResearchGaps || !parsedProsCons) {
             console.error("One or more sections failed to parse correctly from LLM response.");
             // Optionally provide more detail in the error
             const errorDetails = [
                 !parsedStepByStep && "step-by-step guide",
                 !parsedRankedPapers && "ranked papers",
                 !parsedMethodology && "methodology",
                 !parsedResearchGaps && "research gaps",
                 !parsedProsCons && "pros and cons"
             ].filter(Boolean).join(', ');

             return {
                 thesisDescription,
                 stepByStep: parsedStepByStep, // Send partially parsed data if needed
                 relatedPapers: parsedRankedPapers,
                 methodology: parsedMethodology,
                 researchGapAnalysis: parsedResearchGaps,
                 prosAndCons: parsedProsCons,
                 error: `Failed to parse the following sections from the AI: ${errorDetails}. The structure might be invalid.`
             };
        }


        // 📜 Return the complete, parsed roadmap
        return {
            thesisDescription,
            stepByStep: parsedStepByStep,
            relatedPapers: parsedRankedPapers, // Use the parsed ranked papers
            methodology: parsedMethodology,
            researchGapAnalysis: parsedResearchGaps,
            prosAndCons: parsedProsCons,
        };

    } catch (error: any) {
        console.error("Error generating thesis roadmap:", error.message || error);
        // Return an error structure to the frontend
        return {
            thesisDescription,
            stepByStep: extractAndParseJson(stepByStepRaw, "stepByStep (on error)"), // Attempt parsing even on error
            relatedPapers: extractAndParseJson(rankedPapersRaw, "relatedPapers (on error)"),
            methodology: extractAndParseJson(methodologyRaw, "methodology (on error)"),
            researchGapAnalysis: extractAndParseJson(researchGapAnalysisRaw, "researchGapAnalysis (on error)"),
            prosAndCons: extractAndParseJson(prosAndConsRaw, "prosAndCons (on error)"),
            error: `Failed to generate thesis roadmap: ${error.message || 'Unknown error'}`
        };
    }
};


// --- Paper Fetching Logic (fetchRelatedPapers and specific providers remain the same) ---
// [fetchRelatedPapers, fetchFromSemanticScholar, fetchFromOpenAlex, fetchFromCORE, invertAbstract functions go here - unchanged from your code]
// Helper Type for Error Handling
type ApiError = Error | AxiosError;

// Provider Specific Fetch Functions (Copied from your code, assumed correct)
const fetchFromSemanticScholar = async (query: string): Promise<ResearchPaper[]> => {
  const response = await axios.get(SEMANTIC_SCHOLAR_API, {
    params: { query: query, fields: "title,url,abstract,citationCount,authors", limit: MAX_RESULTS },
  });
  if (Array.isArray(response.data.data) && response.data.data.length > 0) {
    return response.data.data.map((paper: any): ResearchPaper => ({
      title: paper.title || "Untitled",
      url: paper.url || "",
      paperLink: paper.url || "",
      abstract: paper.abstract || "No abstract available",
      citationCount: paper.citationCount || 0,
      authors: paper.authors?.map((a: any) => a.name).join(", ") || "Unknown authors",
    }));
  } else if (response.data.data && response.data.data.length === 0) {
     console.log("Semantic Scholar returned 0 results."); return [];
  } else { throw new Error("Invalid data format received from Semantic Scholar"); }
};

const fetchFromOpenAlex = async (query: string): Promise<ResearchPaper[]> => {
  const response = await axios.get(OPENALEX_API, { params: { search: query, per_page: MAX_RESULTS }});
  if (Array.isArray(response.data.results) && response.data.results.length > 0) {
    return response.data.results.map((paper: any): ResearchPaper => ({
      title: paper.display_name || "Untitled",
      url: paper.id ? `https://openalex.org/${paper.id.split('/').pop()}` : "",
      paperLink: paper.primary_location?.landing_page_url || paper.primary_location?.pdf_url || "",
      abstract: paper.abstract_inverted_index ? invertAbstract(paper.abstract_inverted_index) : "No abstract available",
      citationCount: paper.cited_by_count || 0,
      authors: paper.authorships?.map((a: any) => a.author?.display_name).filter(Boolean).join(", ") || "Unknown authors",
    }));
  } else if (response.data.results && response.data.results.length === 0) {
      console.log("OpenAlex returned 0 results."); return [];
  } else { throw new Error("Invalid data format received from OpenAlex"); }
};

const invertAbstract = (invertedIndex: Record<string, number[]>): string => {
    if (!invertedIndex) return "No abstract available";
    const map: { [key: number]: string } = {};
    for (const word in invertedIndex) { invertedIndex[word].forEach(pos => { map[pos] = word; }); }
    return Object.keys(map).map(Number).sort((a, b) => a - b).map(pos => map[pos]).join(' ');
};

const fetchFromCORE = async (query: string): Promise<ResearchPaper[]> => {
  if (!CORE_API_KEY || CORE_API_KEY === "YOUR_CORE_API_KEY") { console.warn("CORE API Key not configured."); return []; }
  const response = await axios.get(CORE_API, { params: { q: query, limit: MAX_RESULTS }, headers: { 'Authorization': `Bearer ${CORE_API_KEY}` }});
  if (Array.isArray(response.data.results) && response.data.results.length > 0) {
    return response.data.results.map((paper: any): ResearchPaper => ({
      title: paper.title || "Untitled",
      url: paper.doi ? `https://doi.org/${paper.doi}` : (paper.downloadUrl || ""),
      paperLink: paper.downloadUrl || (paper.doi ? `https://doi.org/${paper.doi}` : ""),
      abstract: paper.abstract || "No abstract available",
      citationCount: paper.citationCount ?? 0,
      authors: paper.authors?.join(", ") || "Unknown authors",
    }));
  } else if (response.data.results && response.data.results.length === 0) {
      console.log("CORE returned 0 results."); return [];
  } else { throw new Error("Invalid data format received from CORE"); }
};

// Main Fetch Function with Fallback Logic (Copied from your code, assumed correct)
export const fetchRelatedPapers = async (thesisDescription: string): Promise<ResearchPaper[]> => {
  const providers: PaperProvider[] = [
    { name: "Semantic Scholar", fetchFunction: fetchFromSemanticScholar },
    { name: "OpenAlex", fetchFunction: fetchFromOpenAlex },
    { name: "CORE", fetchFunction: fetchFromCORE },
  ];
  for (const provider of providers) {
    console.log(`Attempting to fetch from ${provider.name}...`);
    try {
      const results = await provider.fetchFunction(thesisDescription);
      if (results.length > 0) { console.log(`Successfully fetched ${results.length} papers from ${provider.name}.`); return results; }
      else { console.log(`${provider.name} returned successfully but found 0 relevant papers.`); }
    } catch (error: unknown) {
      const err = error as ApiError; let errorMessage = err.message;
      if (axios.isAxiosError(err) && err.response) {
        errorMessage = `Status ${err.response.status}: ${JSON.stringify(err.response.data)}`;
        if (provider.name === "Semantic Scholar" && err.response.status === 429) { console.warn(`Rate limit hit for ${provider.name}. Falling back...`); }
      }
      console.error(`Error fetching from ${provider.name}:`, errorMessage);
    }
  }
  console.warn("All paper providers failed or returned no results."); return [];
};


// --- LLM Interaction Helpers (Modified to return raw strings) ---

// 📌 Helper function to rank & summarize papers using LLM (returns raw string)
const rankAndSummarizePapersLLM = async (
  thesisDescription: string,
  papers: ResearchPaper[]
): Promise<string | null> => { // Return type changed to string | null
  try {
    // Prepare paper details (no change needed here)
    const paperDetails = papers.map((p) => ({
      title: p.title, abstract: p.abstract, url: p.url,
      paperLink: p.paperLink, citationCount: p.citationCount, authors: p.authors,
    }));
    const paperDetailsJson = JSON.stringify(paperDetails, null, 2); // Use pretty print for LLM?

    const prompt = PromptGenerator.rankPapers(thesisDescription, paperDetailsJson);
    return await callGemini(prompt, "rank and summarize papers"); // Return raw string

  } catch (error: any) {
    console.error("Error preparing data for rankAndSummarizePapersLLM:", error.message || error);
    return JSON.stringify([{ error: "Failed to prepare data for research ranking." }]); // Return error as stringified JSON
  }
};

// 📌 Generate Research Gap Analysis using LLM (returns raw string)
const generateResearchGapAnalysisLLM = async (relatedPapers: ResearchPaper[], thesisDescription: string): Promise<string | null> => { // Return type changed
  try {
    // Ensure input is an array before mapping
    if (!Array.isArray(relatedPapers)) {
        console.error("generateResearchGapAnalysisLLM received non-array:", relatedPapers);
        return JSON.stringify({ error: "Internal error: Invalid paper data received for analysis." });
    }
    const abstracts = relatedPapers.map((paper) => paper.abstract).join("\n\n---\n\n"); // Add separator
    const prompt = PromptGenerator.researchGaps(abstracts, thesisDescription);
    return await callGemini(prompt, "research gap analysis"); // Return raw string
  } catch (error: any) {
    console.error("Error preparing data for generateResearchGapAnalysisLLM:", error.message || error);
    return JSON.stringify({ error: "Failed to prepare data for research gap analysis." });
  }
};

// 📌 Generate Pros & Cons using LLM (returns raw string)
const generateProsAndConsLLM = async (relatedPapers: ResearchPaper[], thesisDescription: string): Promise<string | null> => { // Return type changed
  try {
    // Ensure input is an array before mapping
    if (!Array.isArray(relatedPapers)) {
        console.error("generateProsAndConsLLM received non-array:", relatedPapers);
        return JSON.stringify({ error: "Internal error: Invalid paper data received for pros/cons analysis." });
    }
    const abstracts = relatedPapers.map((paper) => paper.abstract).join("\n\n---\n\n"); // Add separator
    const prompt = PromptGenerator.prosCons(abstracts, thesisDescription);
    return await callGemini(prompt, "pros and cons"); // Return raw string
  } catch (error: any) {
    console.error("Error preparing data for generateProsAndConsLLM:", error.message || error);
     return JSON.stringify({ error: "Failed to prepare data for pros and cons analysis." });
  }
};

// 📌 Generic function to call Google Gemini API (Modified for better error checking)
const callGemini = async (prompt: string, context: string): Promise<string | null> => {
    console.log(`Calling Gemini API for: ${context}`);
    try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent`, // Using v1beta and latest model
          {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            // Optional: Add safety settings if needed
            // safetySettings: [
            //   { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            //   // Add other categories as needed
            // ],
            // Optional: Add generation config
             generationConfig: {
                 temperature: 0.6, // Adjust creativity vs factualness
                 // topP: 0.9,
                 // topK: 40,
                 // maxOutputTokens: 8192, // Model default
                 responseMimeType: "application/json", // Explicitly request JSON output!
             }
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
            params: {
              key: GOOGLE_API_KEY,
            },
             timeout: 60000 // 60 second timeout
          }
        );

        // --- Robust Response Checking ---
        if (!response.data) {
            console.error(`Error calling Gemini API for ${context}: No response data received.`);
            throw new Error("Empty response from Gemini API");
        }

        // Check for prompt feedback (e.g., blocked due to safety)
        if (response.data.promptFeedback?.blockReason) {
             console.error(`Error calling Gemini API for ${context}: Prompt blocked. Reason: ${response.data.promptFeedback.blockReason}`);
             console.error(`Safety Ratings: ${JSON.stringify(response.data.promptFeedback.safetyRatings)}`);
             throw new Error(`AI request blocked due to safety settings: ${response.data.promptFeedback.blockReason}`);
        }

        if (!response.data.candidates || response.data.candidates.length === 0) {
            // Check if finishReason provides clues (e.g., SAFETY, RECITATION, MAX_TOKENS)
            const finishReason = response.data.candidates?.[0]?.finishReason || 'UNKNOWN';
            console.error(`Error calling Gemini API for ${context}: No candidates received. Finish Reason: ${finishReason}`);
            throw new Error(`No response generated by AI. Reason: ${finishReason}`);
        }

        const candidate = response.data.candidates[0];

        if(candidate.finishReason && candidate.finishReason !== 'STOP'){
             console.warn(`Gemini API for ${context} finished with reason: ${candidate.finishReason}. Output might be incomplete.`);
             // Decide if you want to throw an error or proceed with potentially truncated data.
             // For now, we proceed but log the warning.
        }

        if (!candidate.content?.parts?.[0]?.text) {
            console.error(`Error calling Gemini API for ${context}: Missing text content in response candidate.`);
            console.error(`Received candidate: ${JSON.stringify(candidate)}`);
            throw new Error("Invalid response structure from Gemini API (missing text)");
        }
        // --- End Robust Checking ---

        const rawText = candidate.content.parts[0].text;
        // console.log(`Raw Gemini response for ${context} (first 300 chars): ${rawText.substring(0, 300)}`); // Optional: Log raw response snippet
        return rawText; // Return the raw text

      } catch (error: any) {
        console.error(`Error calling Gemini API for ${context}:`, axios.isAxiosError(error) ? error.response?.data || error.message : error.message);
        // Rethrow or return null/error indicator. Rethrowing for main handler.
        throw new Error(`Failed to get response from AI for ${context}.`);
      }
    };