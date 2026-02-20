import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

export const createSearchRedditTool = () => {
    return createTool({
        name: "searchReddit",
        description: "Search Reddit (specifically r/programming, r/learnprogramming, etc.) for discussions and opinions.",
        parameters: z.object({
            query: z.string().describe("The search query for Reddit"),
        }),
        handler: async ({ query }, { step }) => {
            if (!step) throw new Error("Step context is required");
            try {
                return await step.run("search-reddit", async () => {
                    const params = new URLSearchParams({
                        q: query,
                        sort: "relevance",
                        limit: "5",
                    });

                    const response = await fetch(
                        `https://www.reddit.com/search.json?${params.toString()}`,
                        {
                            headers: {
                                'User-Agent': 'node:polaris-agent:v1.0.0 (by /u/polaris-dev)'
                            }
                        }
                    );

                    if (!response.ok) {
                        return `Error searching Reddit: ${response.statusText}`;
                    }

                    const data = await response.json();
                    const posts = data.data?.children || [];

                    if (posts.length === 0) {
                        return "No results found on Reddit.";
                    }

                    // Define a minimal interface for the post structure we expect
                    interface RedditPost {
                        data: {
                            title: string;
                            permalink: string;
                            subreddit: string;
                            score: number;
                            num_comments: number;
                            selftext?: string;
                        }
                    }

                    return JSON.stringify(posts.map((post: RedditPost) => ({
                        title: post.data.title,
                        url: `https://www.reddit.com${post.data.permalink}`,
                        subreddit: post.data.subreddit,
                        score: post.data.score,
                        num_comments: post.data.num_comments,
                        selftext: post.data.selftext?.substring(0, 200) + "...",
                    })));
                });
            } catch (error) {
                return `Failed to search Reddit: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });
};
