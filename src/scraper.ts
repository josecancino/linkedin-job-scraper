import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser } from 'playwright';

// Add stealth plugin to playwright-extra
chromium.use(stealthPlugin());

export interface Job {
    title: string;
    company: string;
    location: string;
    link: string;
    description: string;
}

export class LinkedInScraper {
    private browser: Browser | null = null;
    private page: any = null; // Store active page reference

    async init() {
        console.log("Attempting to connect to Chrome on port 9222...");
        try {
            // Try to connect to existing Chrome instance on port 9222
            this.browser = await chromium.connectOverCDP('http://localhost:9222');
            console.log("✅ Successfully connected to existing Chrome instance!");
        } catch (e) {
            console.log("❌ Could not connect to existing Chrome on port 9222.");
            console.log("Please ensure you ran: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222'");
            console.log("Launching new instance as fallback (might not have your session)...");

            this.browser = await chromium.launch({
                headless: false,
                channel: 'chrome'
            });
        }
    }

    async login(email: string, pass: string) {
        if (!this.browser) throw new Error("Browser not initialized");

        // Try to find an existing page that is already on LinkedIn
        let page = null;
        const contexts = this.browser.contexts();

        console.log(`Found ${contexts.length} browser contexts.`);

        // Search through all contexts and pages
        for (const context of contexts) {
            const pages = context.pages();
            console.log(`Context has ${pages.length} pages.`);

            for (const p of pages) {
                const url = p.url();
                console.log(`Checking page: ${url}`);
                if (url.includes('linkedin.com')) {
                    console.log("✅ Found existing LinkedIn tab! Using it.");
                    page = p;
                    // Bring to front
                    await page.bringToFront();
                    break;
                }
            }
            if (page) break;
        }

        // If no LinkedIn tab found, use the first available page or create new
        if (!page) {
            console.log("No existing LinkedIn tab found. Using first available page...");
            const context = contexts.length > 0 ? contexts[0] : await this.browser.newContext();
            const pages = context.pages();
            page = pages.length > 0 ? pages[0] : await context.newPage();
        }

        // Save page reference for scraper
        this.page = page;

        console.log(`Active page: ${page.url()}`);

        // Check if we are already on LinkedIn (double check)
        if (!page.url().includes('linkedin.com')) {
            console.log("Navigating to LinkedIn...");
            await page.goto('https://www.linkedin.com/feed/');
        } else {
            console.log("Reloading current LinkedIn page to ensure fresh state...");
            await page.reload({ waitUntil: 'domcontentloaded' });
        }

        console.log("Checking login status...");

        // Wait up to 10 seconds to see if we are on feed
        try {
            await page.waitForURL('**/feed/**', { timeout: 5000 });
            console.log("✅ Already on Feed page!");
            return;
        } catch (e) {
            console.log("Not on feed yet (or URL pattern mismatch). Checking page content...");
        }

        // If not on feed, maybe we need to login
        if (page.url().includes('login') || page.url().includes('google') || page.url().includes('guest')) {
            console.log("\n⚠️  ACTION REQUIRED ⚠️");
            console.log("Please log in manually in the browser window.");
            console.log("Waiting for you to reach the LinkedIn Feed...");

            // Wait forever until feed is reached
            await page.waitForURL('**/feed/**', { timeout: 0 });
            console.log("✅ Login detected! Starting scraper...");
        } else {
            console.log("Assuming we are logged in or in a valid state. Proceeding...");
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    async scrape(keyword: string, location: string, maxJobs: number = 25): Promise<Job[]> {
        if (!this.browser) throw new Error("Browser not initialized");

        // Use existing page from login or create new one if not available
        let page = this.page;
        if (!page) {
            const context = await this.browser.newContext();
            page = await context.newPage();
            this.page = page;
        }

        const url = `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}`;

        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Wait for job list to load
        try {
            await page.waitForSelector('.scaffold-layout__list-container', { timeout: 10000 });
        } catch (e) {
            console.log("Could not find job list selector. Please ensure you are logged in.");
        }

        const scrapedJobs: Job[] = [];
        const visitedLinks = new Set<string>();
        let noNewJobsCount = 0;

        console.log(`Starting scrape for ${maxJobs} jobs...`);

        // Selector for the scrollable list of jobs
        const JOB_LIST_SELECTOR = '.jobs-search-results-list, .scaffold-layout__list-container';
        // Selector for individual job cards in the list
        const JOB_CARD_SELECTOR = '.jobs-search-results__list-item, .job-card-container, li.occludable-update';

        while (scrapedJobs.length < maxJobs) {
            // Get all visible job cards
            const jobCards = await page.$$(JOB_CARD_SELECTOR);

            if (jobCards.length === 0) {
                console.log("No job cards found. Waiting...");
                await page.waitForTimeout(2000);
                noNewJobsCount++;
                if (noNewJobsCount > 3) break;
                continue;
            }

            let processedInThisBatch = 0;

            for (const card of jobCards) {
                if (scrapedJobs.length >= maxJobs) break;

                // Improved Deduplication: Check data-job-id first if available to avoid clicking
                const cardJobId = await card.getAttribute('data-job-id');
                const cardText = (await card.innerText()).split('\n')[0]; // simple title fallback

                if (cardJobId && visitedLinks.has(cardJobId)) {
                    continue;
                }

                // Scroll card into view to ensure it's clickable and content is rendered
                try {
                    await card.scrollIntoViewIfNeeded();
                } catch (e) {
                    continue; // usage might be detached
                }

                // Click the card to load details
                await card.click().catch(() => { }); // ignore click errors

                // Wait a bit for details to load
                await page.waitForTimeout(800); // Small delay for UI update

                // Extract details from the Right Pane (Details View)
                const jobData = await page.evaluate(() => {
                    const detailsContainer = document.querySelector('.jobs-search__job-details--wrapper') ||
                        document.querySelector('.job-view-layout');

                    if (!detailsContainer) return null;

                    const getText = (selector: string) => {
                        const el = detailsContainer.querySelector(selector) as HTMLElement;
                        return el ? el.innerText.trim() : '';
                    };

                    const getLink = (selector: string) => {
                        const el = detailsContainer.querySelector(selector);
                        return el ? el.getAttribute('href') : '';
                    };

                    // Selectors identified for "Unified Top Card" and Description
                    const title = getText('.job-details-jobs-unified-top-card__job-title a') ||
                        getText('h2.job-details-jobs-unified-top-card__job-title');

                    const company = getText('.job-details-jobs-unified-top-card__company-name a') ||
                        getText('.job-details-jobs-unified-top-card__company-name');

                    const location = getText('.job-details-jobs-unified-top-card__primary-description-container') ||
                        getText('.job-details-jobs-unified-top-card__primary-description');

                    const description = getText('.jobs-description-content__text') ||
                        getText('.jobs-description__container') ||
                        getText('#job-details');

                    const link = getLink('.job-details-jobs-unified-top-card__job-title a');

                    return { title, company, location, description, link };
                });

                if (jobData && jobData.title) {
                    // Start normalization
                    let normalizedLink = '';
                    if (jobData.link) {
                        // Build absolute URL
                        const fullLink = jobData.link.startsWith('http') ? jobData.link : `https://www.linkedin.com${jobData.link}`;
                        // Remove query parameters for strict deduplication (keep path only: /jobs/view/123456)
                        try {
                            const urlObj = new URL(fullLink);
                            // Keep only protocol, host, and pathname
                            normalizedLink = `${urlObj.origin}${urlObj.pathname}`;
                        } catch (e) {
                            normalizedLink = fullLink;
                        }
                    }

                    // Strict check against visited
                    if ((normalizedLink && visitedLinks.has(normalizedLink)) || (cardJobId && visitedLinks.has(cardJobId))) {
                        continue;
                    }

                    // Clean up data
                    const jobEntry: Job = {
                        title: jobData.title.replace(/\n/g, '').trim(),
                        company: jobData.company.replace(/\n/g, '').trim(),
                        location: jobData.location.replace(/\n/g, '').trim(),
                        link: jobData.link ? (jobData.link.startsWith('http') ? jobData.link : `https://www.linkedin.com${jobData.link}`) : '',
                        description: jobData.description
                    };

                    console.log(`+ Scraped: ${jobEntry.title} at ${jobEntry.company}`);
                    scrapedJobs.push(jobEntry);

                    // Add to visited
                    if (normalizedLink) visitedLinks.add(normalizedLink);
                    if (cardJobId) visitedLinks.add(cardJobId);
                    if (!normalizedLink && !cardJobId) visitedLinks.add(jobEntry.title + jobEntry.company); // Last resort

                    processedInThisBatch++;
                    noNewJobsCount = 0;
                }
            }

            if (processedInThisBatch === 0) {
                console.log("No new jobs found in this batch. Scrolling...");
                // Scroll the list container
                await page.evaluate((selector: string) => {
                    const list = document.querySelector(selector);
                    if (list) {
                        list.scrollBy(0, list.clientHeight);
                    } else {
                        window.scrollBy(0, window.innerHeight);
                    }
                }, JOB_LIST_SELECTOR);

                await page.waitForTimeout(2000);
                noNewJobsCount++;

                if (noNewJobsCount >= 5) {
                    console.log("Stopping: No new jobs found after multiple scrolls.");
                    break;
                }
            }
        }

        return scrapedJobs;
    }
}
