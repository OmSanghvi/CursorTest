import { createTool } from "@inngest/agent-kit";
import { z } from "zod";
import { firecrawl } from "@/lib/firecrawl";

export const createSearchWebTool = () => {
  return createTool({
    name: "search-web",
    description: "Search the web (including Stack Overflow, Reddit, and documentation) for code suggestions, bug fixes, and best practices.",
    parameters: z.object({
      query: z.string().describe("The search query to find code solutions or documentation"),
      sites: z.array(z.string()).optional().describe("Specific sites to search (e.g. ['stackoverflow.com', 'reddit.com'])"),
    }),
    handler: async (input, { step }) => {
      // Cast input to expected type safely
      const { query, sites } = input as { query: string; sites?: string[] };
      if (!step) throw new Error("Step context is required");

      let searchQuery = query;
      if (sites && sites.length > 0) {
        searchQuery += " (" + sites.map(site => `site:${site}`).join(" OR ") + ")";
      }

      try {
        // cast to any to handle SDK type mismatch
        const searchResult = await firecrawl.search(searchQuery, {
          limit: 5,
          scrapeOptions: { formats: ["markdown"] },
        }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

        if (searchResult.success === false) {
          return {
            success: false,
            error: searchResult.error || "Unknown search error",
          };
        }

        // Handle successful response (array or object with data)
        const items = Array.isArray(searchResult) ? searchResult : (searchResult.data || []);

        return {
          success: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          results: items.map((item: any) => ({
            title: item.title,
            url: item.url,
            content: item.markdown,
          })),
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to search the web";
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
  });
};
