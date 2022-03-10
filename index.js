const express = require('express');
const cors = require("cors");
const database = require('./firebaseConfig')
const fetch = require('node-fetch');
const axios = require('axios');
const cio = require('cheerio-without-node-native');
const puppeteer = require('puppeteer');
require('dotenv').config()


const app = express();
app.use(express.json());
app.use(cors());

let spotifyAuthorizationToken = 'BQBmvCiqim5w9R2uFpT8kt2LYm1-juMKrYc5F_c4e2yXSZ4WQUZ2RBDHm64ZA_3h9Zy451wpICFeBFKsVKyMh9dUk_rlmZ3PYiLma1ynxY4f209NfYPoNB_HfgmzrEFlsQ-43QBLd1er-69V2r-XihyCqNWFSVs'

async function scrapeNewSpotifyToken() {
  const browser = await puppeteer.launch({
    'args' : [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
  const page = await browser.newPage();

  await page.goto('https://developer.spotify.com/console/get-playlist/?playlist_id=&market=&fields=&additional_types=');
  await page.waitForSelector("button.btn.btn-green");
  await page.click('button.btn.btn-green');

  await page.$eval('input[value="Request Token"]', el => el.click());

  await page.waitForNavigation();
  await page.type('#login-username', process.env.SPOTIFYMAIL);
  await page.type('#login-password', process.env.SPOTIFYPASS);
  await page.click('.ButtonInner-sc-14ud5tc-0');

  await page.waitForNavigation();
  const element = await page.waitForSelector("input#oauth-input.form-control");
  const authToken = await page.evaluate(element => element.value, element);

  browser.close();
  return authToken;
}
scrapeNewSpotifyToken();

let fetchTop50Itterations = 0;

const fetchTop50 = async (itterations) => {
  try {
    const response = 
      await fetch('https://api.spotify.com/v1/playlists/37i9dQZEVXbNG2KDcFcKOF', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + spotifyAuthorizationToken
        }
      });

    const data = await response.json();
    fetchTop50Itterations = 0;
    if (data.error) {
      throw error = data.error;
    } else {
      return data;
    }

  } catch (error) {
    if (error.status === 401) {
      if (itterations >= 3) return 'Unable to fetch newToken';
      spotifyAuthorizationToken = await scrapeNewSpotifyToken();
      fetchTop50(fetchTop50Itterations+1)
    }
  }
}

setInterval(function(){ 
  scrapeNewSpotifyToken();
}, 600000);

const checkOptions = (options) => {
	let { apiKey, title, artist } = options;
	if (!apiKey) {
		throw '"apiKey" property is missing from options';
	} else if (!title) {
		throw '"title" property is missing from options';
	} else if (!artist) {
		throw '"artist" property is missing from options';
	}
};

const getTitle = (title, artist) => {
	return `${title} ${artist}`
		.toLowerCase()
		.replace(/ *\([^)]*\) */g, '')
		.replace(/ *\[[^\]]*]/, '')
		.replace(/feat.|ft./g, '')
		.replace(/\s+/g, ' ')
		.trim();
};

/**
 * @param {{apiKey: string, title: string, artist: string, optimizeQuery: boolean, authHeader: boolean}} options
 */
const searchUrl = 'https://api.genius.com/search?q=';
const searchSong = async (options) => {

	try {
		checkOptions(options);
		let { apiKey, title, artist, optimizeQuery = false, authHeader = false } = options;
		const song = optimizeQuery ? getTitle(title, artist) : `${title} ${artist}`;
		const reqUrl = `${searchUrl}${encodeURIComponent(song)}`;
		const headers = {
			Authorization: 'Bearer ' + apiKey
		};
		let { data } = await axios.get(
			authHeader ? reqUrl : `${reqUrl}&access_token=${apiKey}`,
			authHeader && { headers }
		);
		if (data.response.hits.length === 0) return null;
		const results = data.response.hits.map((val) => {
			const { full_title, song_art_image_url, id, url } = val.result;
			return { id, title: full_title, albumArt: song_art_image_url, url };
		});
		return results;
	} catch (e) {
		throw e;
	}
};

const extractLyrics = async (url) => { // RM Git från denna och getLyricsGit
	try {
		let { data } = await axios.get(url);
		const $ = cio.load(data);
		let lyrics = $('div[class="lyrics"]').text().trim();

		if (!lyrics) {
			lyrics = ''
			$('div[class^="Lyrics__Container"]').each((i, elem) => {
				if($(elem).text().length !== 0) {
					let snippet = $(elem).html()
					.replace(/<br>/g, '\n')
					.replace(/<(?!\s*br\s*\/?)[^>]+>/gi, '');
					lyrics += $('<textarea/>').html(snippet).text().trim() + '\n\n';
				}
    	})
		}
		if (!lyrics) return null;
		return lyrics.trim();
	} catch (e) {
		throw e;
	}
};

/**
 * @param {({apiKey: string, title: string, artist: string, optimizeQuery: boolean}|string)} arg - options object, or Genius URL
 */
const getLyrics = async (arg) => {
  try {
		if (arg && typeof arg === 'string') {
			let lyrics = await extractLyrics(arg);
			return lyrics;
		} else if (typeof arg === 'object') {
			checkOptions(arg);
			let results = await searchSong(arg);
			if (!results) return null;
			let lyrics = await extractLyrics(results[0].url);
			return lyrics;
		} else {
			throw 'Invalid argument';
		}
	} catch (e) {
		throw e;
	}
};

const getLyricsForEachSong = async () => {
  let data = await fetchTop50();
  if (data === undefined || data.tracks.items === undefined) return 'Something went wrong';
  data = data.tracks.items;

  // If för att inte köra denna föräns allt är redo för test
  // Gör om hela alltet här och fixa någon snygg lösning som funkar, typ sätt id på alla låtar. uuid kanske (om det hjälper)?
  // NOTE. Gör koll mot firebase om låtarna finns där för att köra resten av denna funktionen är väldigt tids kostande 
  // if (1==2) {
  //   const songDataFromFirestore = 'Hämtning'
  //   data.map(trackItem => {
  //     const trackItemName = trackItem.track.name;
  //     songDataFromFirestore.map(firestoreSong => {
  //       const fireStoreSongTitle = firestoreSong.title;
  //       if (trackItemName !== fireStoreSongTitle) {
  //         // Hämta och ersätt firebasedatan
  //       }
  //     });
  //   });
  // }

  let songsArray = []
  // Kör bara denna om inte lyriken finns på firebase
  for (let index = 0; index < data.length; index++) {
    lyricsStatus = index;
    const trackItemId = data[index].track.id
    const trackItemName = data[index].track.name;
    const trackItemArtist = data[index].track.artists[0].name;

    const lyrics = await getLyrics ({
      apiKey: process.env.GENUISAPIKEY, 
      title: trackItemName, 
      artist: trackItemArtist,
      optimizeQuery: true
    })
    if (lyrics !== null && lyrics !== undefined) {
      const thisSong = {
        id: trackItemId,
        title: trackItemName,
        artist: trackItemArtist,
        song: {
          lyrics: lyrics
        }
      }
      songsArray.push(thisSong);
    }
  }
  return songsArray;
  // await data.map(async trackItem => {
  //   const trackItemId = trackItem.track.id
  //   const trackItemName = trackItem.track.name;
  //   const trackItemArtist = trackItem.track.artists[0].name;

  //   const lyrics = await getLyrics ({
  //     apiKey: process.env.GENUISAPIKEY, 
  //     title: trackItemName, 
  //     artist: trackItemArtist,
  //     optimizeQuery: true
  //   })
  //   if (lyrics !== null && lyrics !== undefined) {
  //     const thisSong = {
  //       id: trackItemId,
  //       title: trackItemName,
  //       artist: trackItemArtist,
  //       song: {
  //         lyrics: lyrics
  //       }
  //     }
  //     songsArray = songsArray.push(thisSong);
  //   }

  //   // Pusha thisSong till firestore
  // });
  // return songsArray
  // return lyrics //tror det är lyrics eller thisSong;
}

app.get('/lyricsfortop50', async (req, res) => {
  let data = await getLyricsForEachSong();
  // data = data.tracks.items
  res.send(data);
});

app.get('/top50', async (req, res) => {
  let data = await fetchTop50();
  res.send(data)
});


// Hämta data från firebase sen jämför mot spotify hämtningen som kommer nu och se skillnaden, är det samma data så gör inget

// setInterval(function(){ 
// 	Uppdatera firebase datan varje dygn (86400000) för att göra så klient kommer kunna ladda snabbare.
// }, 86400000);








// const User = database.collection("Users");
app.get('/users', async (req, res) => {
  const snapshot = await database.collection("Users").get();
  const list = snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() })
  );
  res.send(list);
});


app.post("/create", async (req, res) => {
  const data = req.body;
  await database.collection("Users").add({ data });
  res.send({ msg: "User Added" });
});


app.listen(process.env.PORT, () => {
  console.log(`App listening to http://localhost:${process.env.PORT}`)
});