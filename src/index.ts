import { LinkedInScraper } from './scraper';

(async () => {
    const scraper = new LinkedInScraper();
    await scraper.init();
    
    try {
        console.log("Starting scrape...");
        const jobs = await scraper.scrape('React Developer', 'Madrid', 100);
        console.log(`Found ${jobs.length} jobs:`);
        console.log(JSON.stringify(jobs.slice(0, 3), null, 2));
    } catch (error) {
        console.error("Error scraping:", error);
    } finally {
        await scraper.close();
    }
})();
