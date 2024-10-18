const express = require('express');
const RSSParser = require('rss-parser');
const axios = require('axios');
const path = require('path');
const knex = require('knex')(require('./knexfile').development);

const app = express();
const parser = new RSSParser();

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const archiveServices = [
  'https://archive.today/submit/?url=',
  'https://archive.fo/submit/?url=',
  'https://archive.is/submit/?url=',
  'https://archive.li/submit/?url=',
  'https://archive.md/submit/?url=',
  'https://archive.ph/submit/?url=',
  'https://archive.vn/submit/?url='
];

function getFaviconUrl(url) {
  const domain = new URL(url).hostname;
  return `https://${domain}/favicon.ico`;
}

async function getArchivedUrl(url) {
  for (const service of archiveServices) {
    try {
      const response = await axios.get(service + encodeURIComponent(url));
      return response.request.res.responseUrl;
    } catch (error) {
      console.error(`Error with ${service}:`, error.message);
    }
  }
  throw new Error('All archive services failed');
}

app.get('/', async (req, res) => {
  const feeds = await knex('rss_feeds').select('*');
  let feedRows = feeds.map(feed => `
    <tr>
      <td class="border px-4 py-2">${feed.url}</td>
      <td class="border px-4 py-2">
        <form action="/delete-rss" method="post">
          <input type="hidden" name="id" value="${feed.id}">
          <button type="submit" class="bg-red-500 text-white px-2 py-1 rounded">Delete</button>
        </form>
      </td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>RSS Feed Reader</title>
      <link href="/styles.css" rel="stylesheet">
      <script>
        function toggleTable() {
          const table = document.getElementById('rssTable');
          table.style.display = table.style.display === 'none' ? 'block' : 'none';
        }
      </script>
    </head>
    <body class="bg-gray-100 p-6">
      <div class="max-w-3xl mx-auto bg-white p-6 rounded-lg shadow-md">
        <h1 class="text-2xl font-bold mb-4">RSS Feed Reader</h1>
        <button onclick="toggleTable()" class="bg-indigo-600 text-white px-4 py-2 rounded">Manage RSS Feeds</button>
        <div id="rssTable" style="display: none;" class="mt-4">
          <form action="/rss" method="post" class="mb-4">
            <label for="url" class="block text-sm font-medium text-gray-700">Enter RSS Feed URL:</label>
            <input type="text" id="url" name="url" required class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
            <button type="submit" class="mt-2 px-4 py-2 bg-indigo-600 text-white rounded-md">Save RSS</button>
          </form>
          <table class="min-w-full bg-white">
            <thead>
              <tr>
                <th class="px-4 py-2">RSS Feed URL</th>
                <th class="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${feedRows}
            </tbody>
          </table>
        </div>
        <h2 class="text-xl font-bold mb-4 mt-4">Saved RSS Feeds</h2>
        <ul>
          ${feeds.map(feed => `<li><a href="/rss/${feed.id}" class="text-indigo-600 hover:underline">${feed.url}</a></li>`).join('')}
        </ul>
        <a href="/all-rss" class="mt-4 inline-block px-4 py-2 bg-indigo-600 text-white rounded-md">View All RSS Contents</a>
      </div>
    </body>
    </html>
  `);
});

app.post('/rss', async (req, res) => {
  const feedUrl = req.body.url;

  if (!feedUrl) {
    return res.status(400).send('URL parameter is required');
  }

  try {
    await knex('rss_feeds').insert({ url: feedUrl });
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error saving the RSS feed URL');
  }
});

app.post('/delete-rss', async (req, res) => {
  const feedId = req.body.id;

  try {
    await knex('rss_feeds').where({ id: feedId }).del();
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error deleting the RSS feed URL');
  }
});

app.get('/rss/:id', async (req, res) => {
  const feedId = req.params.id;

  try {
    const feedRecord = await knex('rss_feeds').where({ id: feedId }).first();
    if (!feedRecord) {
      return res.status(404).send('RSS feed not found');
    }

    const feed = await parser.parseURL(feedRecord.url);
    let htmlContent = `<h1 class="text-xl font-bold mb-4">${feed.title}</h1><ul class="space-y-4">`;

    // Sort items by publication date
    feed.items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    for (const item of feed.items) {
      htmlContent += `
        <li class="p-4 bg-gray-50 rounded-lg shadow-md flex items-center">
          <img src="${getFaviconUrl(item.link)}" alt="Favicon" class="w-4 h-4 mr-2">
          <a href="#" onclick="archiveUrl('${item.link}')" class="text-lg font-semibold text-indigo-600 hover:underline">${item.title}</a>
          <p class="mt-2 text-gray-700">${item.contentSnippet}</p>
          <p class="mt-1 text-sm text-gray-500">${item.pubDate}</p>
        </li>`;
    }

    htmlContent += '</ul>';
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${feed.title}</title>
        <link href="/styles.css" rel="stylesheet">
        <script>
          async function archiveUrl(url) {
            try {
              const response = await fetch('/archive', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
              });
              const data = await response.json();
              if (data.archivedUrl) {
                window.open(data.archivedUrl, '_blank');
              } else {
                alert('All archive services failed');
              }
            } catch (error) {
              console.error('Error archiving URL:', error.message);
              alert('All archive services failed');
            }
          }
        </script>
      </head>
      <body class="bg-gray-100 p-6">
        <div class="max-w-3xl mx-auto bg-white p-6 rounded-lg shadow-md">
          ${htmlContent}
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching or parsing the RSS feed');
  }
});

app.post('/archive', async (req, res) => {
  const { url } = req.body;

  try {
    const archivedUrl = await getArchivedUrl(url);
    res.json({ archivedUrl });
  } catch (error) {
    console.error('Error archiving URL:', error.message);
    res.json({ archivedUrl: null });
  }
});

app.get('/all-rss', async (req, res) => {
  try {
    const feeds = await knex('rss_feeds').select('*');
    let allItems = [];

    for (const feedRecord of feeds) {
      const feed = await parser.parseURL(feedRecord.url);
      allItems = allItems.concat(feed.items);
    }

    // Sort all items by publication date
    allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    let htmlContent = '<h1 class="text-xl font-bold mb-4">All RSS Feeds</h1><ul class="space-y-4">';

    for (const item of allItems) {
      htmlContent += `
        <li class="p-4 bg-gray-50 rounded-lg shadow-md flex items-center">
          <img src="${getFaviconUrl(item.link)}" alt="Favicon" class="w-4 h-4 mr-2">
          <a href="#" onclick="archiveUrl('${item.link}')" class="text-lg font-semibold text-indigo-600 hover:underline">${item.title}</a>
          <p class="mt-2 text-gray-700">${item.contentSnippet}</p>
          <p class="mt-1 text-sm text-gray-500">${item.pubDate}</p>
        </li>`;
    }

    htmlContent += '</ul>';
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>All RSS Feeds</title>
        <link href="/styles.css" rel="stylesheet">
        <script>
          async function archiveUrl(url) {
            try {
              const response = await fetch('/archive', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
              });
              const data = await response.json();
              if (data.archivedUrl) {
                window.open(data.archivedUrl, '_blank');
              } else {
                alert('All archive services failed');
              }
            } catch (error) {
              console.error('Error archiving URL:', error.message);
              alert('All archive services failed');
            }
          }

          function toggleTable() {
            const table = document.getElementById('rssTable');
            table.style.display = table.style.display === 'none' ? 'block' : 'none';
          }
        </script>
      </head>
      <body class="bg-gray-100 p-6">
        <div class="max-w-3xl mx-auto bg-white p-6 rounded-lg shadow-md">
          <button onclick="toggleTable()" class="bg-indigo-600 text-white px-4 py-2 rounded">Manage RSS Feeds</button>
          <div id="rssTable" style="display: none;" class="mt-4">
            <form action="/rss" method="post" class="mb-4">
              <label for="url" class="block text-sm font-medium text-gray-700">Enter RSS Feed URL:</label>
              <input type="text" id="url" name="url" required class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              <button type="submit" class="mt-2 px-4 py-2 bg-indigo-600 text-white rounded-md">Save RSS</button>
            </form>
            <table class="min-w-full bg-white">
              <thead>
                <tr>
                  <th class="px-4 py-2">RSS Feed URL</th>
                  <th class="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${feeds.map(feed => `
                  <tr>
                    <td class="border px-4 py-2">${feed.url}</td>
                    <td class="border px-4 py-2">
                      <form action="/delete-rss" method="post">
                        <input type="hidden" name="id" value="${feed.id}">
                        <button type="submit" class="bg-red-500 text-white px-2 py-1 rounded">Delete</button>
                      </form>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${htmlContent}
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching or parsing the RSS feeds');
  }
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});