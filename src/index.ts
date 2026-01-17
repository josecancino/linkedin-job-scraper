import { LinkedInScraper } from './scraper';
import * as dotenv from 'dotenv';

dotenv.config();

(async () => {
    const scraper = new LinkedInScraper();
    await scraper.init();
    
    try {
        if (process.env.GMAIL_EMAIL && process.env.GMAIL_PASSWORD) {
            await scraper.login(process.env.GMAIL_EMAIL, process.env.GMAIL_PASSWORD);
        } else if (process.env.LINKEDIN_EMAIL && process.env.LINKEDIN_PASSWORD) {
            await scraper.login(process.env.LINKEDIN_EMAIL, process.env.LINKEDIN_PASSWORD);
        } else {
            console.warn("No credentials found in .env, running in public mode (limited results)");
        }

        console.log("Starting scrape...");
        // Broader search to test pagination
        const jobs = await scraper.scrape('Software Engineer', 'Spain', 100);
        console.log(`Found ${jobs.length} jobs:`);
        console.log(JSON.stringify(jobs.slice(0, 3), null, 2));
    } catch (error) {
        console.error("Error scraping:", error);
    } finally {
        await scraper.close();
    }
})();
