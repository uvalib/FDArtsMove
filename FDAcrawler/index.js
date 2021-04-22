// APPSESSION env variable needs to be set to the .AspNet.ApplicationCookie cookie value of an authenticated visit to the current inventory site https://artinventory.sites.virginia.edu/
const fetch = require('node-fetch');
const Bottleneck = require("bottleneck");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
var fs = require('fs').promises;

// asset directory
const assets = "assets";

// limit the number of resources to fetch for testing / development
const fetchResultLimit = 1;
const domain = "https://artinventory.sites.virginia.edu";
var package = {};

// Setup a Bottleneck for limiting fetches (be kind)
const limiter = new Bottleneck({
    maxConcurrent: 5,
    minTime: 555
  });

// Header stuff copied from chrome dev tools
const fetchOptions = {
    "headers": {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "sec-ch-ua": "\"Google Chrome\";v=\"89\", \"Chromium\";v=\"89\", \";Not A Brand\";v=\"99\"",
      "sec-ch-ua-mobile": "?0",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      "cookie": `.AspNet.ApplicationCookie=${process.env.APPSESSION};`
    },
    "referrerPolicy": "strict-origin-when-cross-origin",
    "body": null,
    "method": "GET",
    "mode": "cors"
  };

// Allow for multiple tries before giving up when fetching
const fetch_retry = (url, options=fetchOptions, n=10) => fetch(url, options).catch(function(error) {
    if (n === 1) throw error;
    return fetch_retry(url, options, n - 1);
});

// Use this limitedFetch wrapper to get multiple tries and throttleing 
const limitedFetch = limiter.wrap(fetch_retry);  

// Decoding base-64 image
// Source: http://stackoverflow.com/questions/20267939/nodejs-write-base64-image-file
function decodeBase64Image(dataString) 
{
    var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    var response = {};

    if (matches.length !== 3) 
    {
        return new Error('Invalid input string');
    }

    response.type = matches[1];
    response.data = Buffer.from(matches[2], 'base64');

    return response;
}

// Fetch an image (html img snippet with inline base64 src attribute) snippet and save the image as file
function fetchImage2base64 (path, dest, key) {
    return limitedFetch(`${domain}${path}`)
        .then(r=>r.buffer())
        .then(buf=>{
            const imgdom = new JSDOM(buf);
            const src = imgdom.window.document.querySelector('img').getAttribute('src');
            const imageBuffer = decodeBase64Image(src);
            const imageType = imageBuffer.type.match(/\/(.*?)$/)[1];
            const imagePath = `${assets}${path}.${imageType}`;
            dest[key] = imagePath;
            return fs.mkdir( imagePath.replace(/(.*)\/.*/, '$1'), {recursive:true} ).then(
                ()=>{
                    return fs.writeFile(imagePath, imageBuffer.data);
                }
            );
        });
}

function fetchDownload(downLink, obj, key) {
    return limitedFetch(`${domain}${downLink}`)
        .then(r=>{
            filename = r.headers.get('Content-Disposition').replace(/.*\"(.*)\"/,'$1');
            return r.buffer().then(buf=>{
                const dir = downLink.replace(/\?.*/,'');
                return fs.mkdir( `${assets}${dir}`, {recursive:true} ).then(
                    ()=>{
                        obj[key] = `${assets}${dir}/${filename}`;
                        return fs.writeFile(`${assets}${dir}/${filename}`, buf);
                    }
                );
            })
        })
}

// Scrape the panels at the top of the detail page for meta
function scrapePrimaryPanel (id, node) {
    if (!package[id].headerMeta) package[id].headerMeta = {};
    node.querySelectorAll('.panel-body .row').forEach(row=>{

        const cells = row.querySelectorAll('div');
        if (cells && cells.length>=2 ) { 
            package[id].headerMeta[cells[0].textContent.trim()] = cells[1].textContent.trim();
        }
    });
}

function getTableData(tables, id, panelTitle, promises) {
        // Lone tables (outside of rows)
        package[id].tabMeta[panelTitle].tables = [];
        tables.forEach(table=>{
            var tableData = [];
            const tableRows = table.querySelectorAll('tr');
            // get headers
            const tableHeaders = Array.from(tableRows[0].querySelectorAll('th, td')).map(th=>th.textContent.trim());
            // get rows
            for (var i=1; i<tableRows.length; i++) {
                var rowData = {};
                const tableRow = tableRows[i];
                tableRow.querySelectorAll('td').forEach((cell,j)=>{
                    if (cell.textContent.trim() != "Download")
                        rowData[tableHeaders[j]] = cell.textContent.trim();
                    else {
                        const downloadLink = cell.querySelector('a').getAttribute('href');
                        promises.push( fetchDownload(downloadLink, rowData, 'file') );
                    }
                });
                tableData.push(rowData);
            }
            package[id].tabMeta[panelTitle].tables.push(tableData);
        })    
}

function scrapeTabDefaultPanel(id,node,promises) {
    if (!package[id].tabMeta) package[id].tabMeta = {};
    const panelTitle = node.querySelector('.panel-title').textContent.trim();
    package[id].tabMeta[panelTitle] = {};
    const rows = node.querySelectorAll('.panel-body .row');
    const tables = node.querySelectorAll('.panel-body > table');

    if (rows && rows.length>0) {
        rows.forEach(row=>{
            row.querySelectorAll('label').forEach(rowLabel=>{
                if (rowLabel && rowLabel.textContent) {
                    const rowTitle = rowLabel.textContent.trim();
                    const rowVal = rowLabel.nextElementSibling;
                    if (rowVal && rowVal.textContent) {
                        package[id].tabMeta[panelTitle][rowTitle] = rowVal.textContent.trim();
                    }
                }
            });

            // row tables
            const tables = row.querySelectorAll('table')
            
            if (tables.length && tables.length > 0) {
                getTableData(tables, id, panelTitle, promises);
            }
        })
    } else if (tables && tables.length>0) {
        getTableData(tables, id, panelTitle, promises);
    } else {
        package[id].tabMeta[panelTitle]=node.querySelector('.panel-body').textContent.trim();        
    }
}

// every detail page has a set of tabs at the lower half, these are dynamically loaded
// here we take one tab section path, fetch it and scrape the meta from it
function getTabDetail (path,id) {
    return limitedFetch(`${domain}${path}${id}`)
        .then(res => res.text())
        .then(body => {
            var promises = []
            const tabDom = new JSDOM(body);
            tabDom.window.document.querySelectorAll('.panel.panel-default.collapsible')
                .forEach( node=>scrapeTabDefaultPanel(id,node,promises) );
            return Promise.all(promises);
        });
}

// gets the detail page for a resource by id (called for every resource in the search results)
function fetchDetails (id) {
    return limitedFetch(`${domain}/item/Details/${id}`)
        .then(res => res.text())
        .then(body => {
            var promises = [];
            const detailDom = new JSDOM(body);

            // Get the primary image
            const pImg = detailDom.window.document.querySelector('#PrimaryImage');
            if (pImg) {
                promises.push( fetchImage2base64(pImg.getAttribute('data-url'), package[id], 'primaryImage') )
            }

            // scrape the panels at the top
            detailDom.window.document.querySelectorAll('.panel-primary')
                .forEach( node=>scrapePrimaryPanel(id,node) );

            // Fetch the detail tabs for this resource
            ["/Item/_Details/","/Item/_LocationDisplay/","/Item/_Donor/","/Item/_Appraisal_Deed/","/Item/_Purchases/","/Item/_Condition/","/Item/_MaintenanceDisplay/"]
                .forEach( tabpath=>{
                    promises.push( getTabDetail(tabpath,id) );
                });

            return Promise.all(promises);
        })
}

// Kick the crawl off with a search, there are ~1500 items and there is no limit to pageSize so we don't have to paginate the results
limitedFetch(`${domain}/Search/SearchResults?SearchResults-sort=&SearchResults-page=1&SearchResults-pageSize=${fetchResultLimit}&SearchResults-group=&SearchResults-filter=`) 
    .then(res => res.text())
    .then(body => {

        var promises = [];

        const dom = new JSDOM(body);

        // get all the search results
        dom.window.document.querySelectorAll('#SearchResults tbody tr').forEach(row=>{
            const cells = row.querySelectorAll('td');
            const thumbnail = cells[0].querySelector('div').getAttribute('data-url');
            const id = cells[1].textContent.trim();
            package[id] = {
                id: id,
                title: cells[2].textContent.trim(),
                majorBusinessUnit: cells[3].textContent.trim(),
                artCategory: cells[4].textContent.trim(),
                provenance: cells[5].textContent.trim(),
                status: cells[6].textContent.trim(),
                currentLocation: cells[7].textContent.trim(),
                description: cells[8].textContent.trim(),
                history: cells[9].textContent.trim(),
                artist: cells[10].textContent.trim()
            };
            // Get the thumbnail
            promises.push( fetchImage2base64(thumbnail, package[id], 'thumbnail') );
         
            // Go fetch the details from the detail page
            promises.push( fetchDetails(id) );
        });

        return Promise.all(promises);

    }).then(()=>{
        console.log( JSON.stringify(package) );
    });