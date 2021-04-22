# FDArtsMove

The current site does not have an export mechnisim.  In order to review with our existing data set and to archive our current directory a crawler/scraper script has been developed. The crawler script is in development and will map the data to needed import formats as products are evaluated.

In order to run the script you will need a valid session cookie from an authenticated session to the current directory (https://artinventory.sites.virginia.edu/).  The cookie can be copied from the dev tools of your browser and set as en env variable like `export APPSESSION=m_NrL50-PxH2cBiJSK-...` on the command line.

To run the crawler you simply direct the STDOUT to a file like so `node index.js > out.json`.  This will give you a json file containing metadata and an assets directory containing the file attachments.