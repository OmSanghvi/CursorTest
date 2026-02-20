import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

export const createSearchStackOverflowTool = () => {
    return createTool({
        name: "searchStackOverflow",
        description: "Search Stack Overflow for coding solutions, errors, and best practices.",
        parameters: z.object({
            query: z.string().describe("The search query for Stack Overflow"),
        }),
        handler: async ({ query }, { step }) => {
            if (!step) throw new Error("Step context is required");
            try {
                return await step.run("search-stackoverflow", async () => {
                    const params = new URLSearchParams({
                        order: "desc",
                        sort: "relevance",
                        site: "stackoverflow",
                        q: query,
                        pagesize: "5",
                    });

                    const response = await fetch(
                        `https://api.stackexchange.com/2.3/search/advanced?${params.toString()}`
                    );

                    if (!response.ok) {
                        return `Error searching Stack Overflow: ${response.statusText}`;
                    }

                    const data = await response.json();

                    if (!data.items || data.items.length === 0) {
                        return "No results found on Stack Overflow.";
                    }

                    interface StackOverflowItem {
                        title: string;
                        link: string;
                        is_answered: boolean;
                        score: number;
                        answer_count: number;
                    }

                    return JSON.stringify(data.items.map((item: StackOverflowItem) => ({
                        title: item.title,
                        link: item.link,
                        is_answered: item.is_answered,
                        score: item.score,
                        answer_count: item.answer_count,
                    })));
                });
            } catch (error) {
                return `Failed to search Stack Overflow: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });
};
