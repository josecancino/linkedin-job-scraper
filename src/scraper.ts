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

    async scrape(keyword: string, location: string, maxJobs: number = 50): Promise<Job[]> {
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
        
        // Wait for job list to load (Public or Logged In)
        try {
            await Promise.any([
                page.waitForSelector('ul.jobs-search__results-list', { timeout: 10000 }), // Public
                page.waitForSelector('.scaffold-layout__list-container', { timeout: 10000 }), // Logged in
                page.waitForSelector('.jobs-search-results-list', { timeout: 10000 }) // Logged in alt
            ]);
        } catch (e) {
            console.log("Could not find job list selector. Checking page content...");
        }

        let previousHeight = 0;
        let noChangeCount = 0;
        
        console.log(`Loading jobs (target: ${maxJobs})...`);

        while (true) {
            const currentJobsCount = await page.evaluate(() => {
                // Check for public or logged-in selectors
                const publicJobs = document.querySelectorAll('ul.jobs-search__results-list > li').length;
                const loggedInJobs = document.querySelectorAll('.jobs-search-results__list-item').length;
                return publicJobs || loggedInJobs;
            });
            
            console.log(`Jobs loaded: ${currentJobsCount}`);

            if (currentJobsCount >= maxJobs) break;

            // Scroll using keyboard to simulate human behavior
            await page.keyboard.press('End');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Scroll logic for both public (window) and logged in (container)
            await page.evaluate(() => {
                const scrollable = document.querySelector('.jobs-search-results-list') || document.body;
                scrollable.scrollTo(0, scrollable.scrollHeight);
                window.scrollTo(0, document.body.scrollHeight);
            });

            // Try to click "See more jobs" or "See more" buttons
            const clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const seeMore = buttons.find(b => {
                    const text = b.textContent?.trim().toLowerCase() || '';
                    return text.includes('see more') || 
                           text.includes('show more') || 
                           text.includes('ver más') ||
                           text.includes('cargar más');
                });
                
                if (seeMore) {
                    (seeMore as HTMLElement).click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                console.log("Clicked 'See more' button");
                // Wait longer after clicking button
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                // Wait for scroll to trigger load
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            const newHeight = await page.evaluate(() => document.body.scrollHeight);
            
            if (newHeight === previousHeight) {
                noChangeCount++;
                if (noChangeCount >= 3) {
                    console.log("No more jobs loading or limit reached.");
                    break;
                }
            } else {
                noChangeCount = 0;
                previousHeight = newHeight;
            }
        }

        const jobs = await page.evaluate(() => {
            const results: any[] = [];
            
            // Public job search selectors
            const publicCards = document.querySelectorAll('ul.jobs-search__results-list > li');
            
            if (publicCards.length > 0) {
                publicCards.forEach((card) => {
                    const titleEl = card.querySelector('.base-search-card__title');
                    const companyEl = card.querySelector('.base-search-card__subtitle');
                    const locEl = card.querySelector('.job-search-card__location');
                    const linkEl = card.querySelector('a.base-card__full-link');

                    if (titleEl && companyEl) {
                        results.push({
                            title: titleEl.textContent?.trim(),
                            company: companyEl.textContent?.trim(),
                            location: locEl?.textContent?.trim(),
                            link: linkEl?.getAttribute('href')
                        });
                    }
                });
            } else {
                // Logged-in selectors
                const loggedInCards = document.querySelectorAll('.jobs-search-results__list-item');
                loggedInCards.forEach((card) => {
                    const titleEl = card.querySelector('.job-card-list__title');
                    const companyEl = card.querySelector('.job-card-container__primary-description');
                    const locEl = card.querySelector('.job-card-container__metadata-item'); 
                    const linkEl = card.querySelector('a.job-card-container__link') || card.querySelector('a.job-card-list__title');

                    if (titleEl) {
                        results.push({
                            title: titleEl.textContent?.trim(),
                            company: companyEl?.textContent?.trim() || '',
                            location: locEl?.textContent?.trim() || '',
                            link: linkEl ? `https://www.linkedin.com${linkEl.getAttribute('href')}` : ''
                        });
                    }
                });
            }
            return results;
        });

        return jobs;
    }
}
