
'use strict';

console.log('Loading Google News Fetcher function...');

const https = require('https');
const AWS = require('aws-sdk');
const xml2js = require('xml2js');


function fetchGoogleNews() {
    return new Promise((resolve, reject) => { 

        const options = {
            host: 'www.google.com',
            port: 443,
            path: '/alerts/feeds/08872177378638169626/17097934481912220776',
            method: 'GET'
        };

        const request = https.request(options, (response) => {
            console.log('Got Google News RSS data with status code: ' + response.statusCode);
            response.setEncoding('utf8');
            var xmlResponse = '';
            
            response.on('data', function (chunk) {
                xmlResponse += chunk;
            });

            response.on('end', () => {
                resolve(xmlResponse);
            });
            response.on('error', error => {
              reject(error); 
            });
        });      
        
        request.on('error', error => {
           reject(error); 
        });
        
        request.write('');
        request.end();
    });
}

function parseNewsXml(newsXml) {
    return new Promise((resolve, reject) => {

        var parser = new xml2js.Parser();
            
        parser.parseString(newsXml, (err, result) => {
            
            if (err) {
                console.log("PARSE ERROR: " + err);
                const response = {
                    statusCode: 500,
                    body: JSON.stringify("PARSE FAILED."),
                };

                reject(response);
                return;
            }
            
            let feed = result['feed'];
            let entries = feed['entry'];
            var newsItems = [];

            if (entries == undefined) {
                let message = "No RSS entries. Nothing to do.";
                console.log(message);
                resolve([]);
                return;
            }

            for (var i = 0; i < entries.length; i++) {

                if (i >= 10) {
                    break;
                }

                let entry = entries[i];

                console.log("ENTRY " + i + ": " + JSON.stringify(entry));

                let title = entry['title'][0]['_'];
                let strippedTitle = decodeEntities(title.replace(/<[^>]*>?/gm, ''));
                let published = entry['published']; 
                let updated = entry['updated'];
                let content = decodeEntities(entry['content'][0]['_']);
                let strippedContent = content.replace(/<[^>]*>?/gm, '');
                let articleUrl = entry['link'][0]['$']['href'];
    

                var url = require('url');
                var url_parts = url.parse(articleUrl, true);
                var query = url_parts.query;

                let parsedUrl = query['url'];

                let dateTime = new Date(updated);
                let date = dateTime.toISOString().split('T')[0];
                let timestamp = dateTime.getTime();

                let newsItem = {
                    'date': date,
                    'articleUrl': parsedUrl,
                    'timestamp': timestamp,
                    'title': strippedTitle,
                    'dateTime': updated[0],
                    'summary': strippedContent
                }
    
                newsItems.push(newsItem);
            }
            
            console.log("Successfully parsed newsItems. Count: " + newsItems.length);

            resolve(newsItems);
        });
    });
}

function decodeEntities(encodedString) {
    var translate_re = /&(nbsp|amp|quot|lt|gt);/g;
    var translate = {
        "nbsp":" ",
        "amp" : "&",
        "quot": "\"",
        "lt"  : "<",
        "gt"  : ">"
    };
    return encodedString.replace(translate_re, function(match, entity) {
        return translate[entity];
    }).replace(/&#(\d+);/gi, function(match, numStr) {
        var num = parseInt(numStr, 10);
        return String.fromCharCode(num);
    });
}

function deleteAllItems() {

}

function persist(newsItems) {

    return new Promise((resolve, reject) => {

        let documentClient = new AWS.DynamoDB.DocumentClient({
            'region': 'eu-west-1'
        });


        let putRequests = [];       

        newsItems.forEach((newsItem, index) => {

            console.log('NEWS ITEM: ' + JSON.stringify(newsItem));

            putRequests.push({
                PutRequest: {
                    Item: { date: newsItem.date,
                            articleUrl: newsItem.articleUrl,   
                            timestamp: newsItem.timestamp,
                            title: newsItem.title,
                            dateTime: newsItem.dateTime,
                            summary: newsItem.summary
                    } 
                } 
            })
        });

        if (putRequests.length < 1) {
            let message = '0 put requests. Nothing to do.';
            console.log(message);
            resolve(message);
            return;
        }

        let params = { 
            RequestItems: {
                'UKTA-LatestNews': putRequests
            }    
        };
                     
        console.log("Adding " + putRequests.length + " items to DB.. ");     
        
        documentClient.batchWrite(params, function(error, data) {
            
           if (error) {
               console.log('Could not put item: ' + error);
               reject(error);
           } else {
            console.log("Successfully persisted newsItems!"); 
            resolve("Successfully fetched and persisted Google News items. v1.1");        
           }
           
        });
    });
}


exports.handler = async (event) => {
        
        return fetchGoogleNews().then(googleNewsXml => {           
            return parseNewsXml(googleNewsXml);            
        }).then(newsItems => {
            return persist(newsItems);
        });
};
