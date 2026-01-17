import { chromium, Browser } from 'playwright';

export interface Job {
    title: string;
    company: string;
    location: string;
    link: string;
}

export class LinkedInScraper {
    private browser: Browser | null = null;

    async init() {
        this.browser = await chromium.launch({ headless: false }); 
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    async scrape(keyword: string, location: string, maxJobs: number = 50): Promise<Job[]> {
        if (!this.browser) throw new Error("Browser not initialized");
        
        const page = await this.browser.newPage();
        const url = `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}`;
        
        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        
        // Wait for job list to load
        try {
            // Selector for job card container in public view
            await page.waitForSelector('ul.jobs-search__results-list', { timeout: 10000 });
        } catch (e) {
            console.log("Could not find job list selector. Checking page content...");
            // await page.screenshot({ path: 'debug-screenshot.png' });
        }

        let previousHeight = 0;
        let noChangeCount = 0;
        
        console.log(`Loading jobs (target: ${maxJobs})...`);

        while (true) {
            const currentJobsCount = await page.evaluate(() => {
                return document.querySelectorAll('ul.jobs-search__results-list > li').length;
            });
            
            console.log(`Jobs loaded: ${currentJobsCount}`);

            if (currentJobsCount >= maxJobs) break;

            // Scroll to bottom
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });

            // Try to click "See more jobs" if available
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const seeMore = buttons.find(b => {
                    const text = b.textContent?.trim().toLowerCase() || '';
                    return text.includes('see more jobs') || 
                           text.includes('show more') || 
                           text.includes('ver más') ||
                           text.includes('cargar más');
                });
                if (seeMore) (seeMore as HTMLElement).click();
            });

            // Wait for new content
            await new Promise(resolve => setTimeout(resolve, 2000));

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
            const cards = document.querySelectorAll('ul.jobs-search__results-list > li');
            
            cards.forEach((card) => {
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
            return results;
        });

        return jobs;
    }
}
