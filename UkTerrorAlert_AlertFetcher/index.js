const https = require('https');
const xml2js = require('xml2js');

const AWS = require('aws-sdk');
const LevelTableName = 'UKTA-Levels';
const AlertTableName = 'UKTA-Alerts';

function getRankForSummary(levels, summary) {
    
    var rank;
    
    levels.forEach(function(element) {
        if (element['summary'] == summary) {
            rank = element['rank'];
        }
    });
    
    return rank;
}

function alertRecordExistsInParameterStore(newAlert) {
    return new Promise((resolve, reject) => { 
        
        var servmgr = new AWS.SSM();

        const prodPath =  { Path : '/UKTA/PROD/'}
        servmgr.getParametersByPath(prodPath, (error, data) => {
            if (error) {
                reject(error);
            } 
            
            console.log("Got data from Parameter Store: " + JSON.stringify(data));
            
            var alert = {};
            
            data["Parameters"].forEach(item => {
               
               let name = item["Name"];
               var strippedName = name.substr(name.lastIndexOf('/') + 1);
               var value = item["Value"];
               
               if (strippedName == "irelandLevel" || strippedName == "nationalLevel") {
                    value = parseInt(value, 10);   
               }

               alert[strippedName] = value;
            });
            
            console.log("Done building alert: " + JSON.stringify(alert));
            
            if (newAlert["publishedDate"] == alert["publishedDate"]) {
                resolve(true);
            } else {
                resolve(false);
            }
            
            
            return resolve(alert);
        });
    });
}

function alertRecordExistsInDb(alert) {
    return new Promise((resolve, reject) => {
        
        let alertId = alert["lastBuildDate"];

        const params = {
            TableName: AlertTableName,
            Key: { lastBuildDate: alertId }
        };
        
        let documentClient = new AWS.DynamoDB.DocumentClient({
            'region': 'eu-west-1'
        });

        documentClient.get(params, (error, result) => {
            if (error) {
                reject(error);
                return;
            }
            
            if (result.Item !== undefined && result.Item !== null) {
                resolve(true);
            } else {
                resolve(false);
            }
            
        });
    });
}

function fetchLevelsFromDb() {
    return new Promise((resolve, reject) => { 
        
        let scanParams = { TableName: LevelTableName, 
                FilterExpression: 'ID > :id',
                ExpressionAttributeValues: { ':id': 0}
        };
        
        let documentClient = new AWS.DynamoDB.DocumentClient({
            'region': 'eu-west-1'
        });

        documentClient.scan(scanParams, function(error, data) {
           
           if (error) {
               console.log('Could not get data: ' + error);
               reject('Could not get data: ' + error);
               return;
           } 
             
            let levels = data['Items'];
            
            console.log('Got levels. Count: ' + levels.length);
            
            resolve(levels);
        });
    });
}

function fetchAlertData() {
    return new Promise((resolve, reject) => { 
        
        const options = {
            host: 'www.mi5.gov.uk',
            port: 443,
            path: '/UKThreatLevel/UKThreatLevel.xml',
            method: 'GET'
        };

        const request = https.request(options, (response) => {
            console.log('Got alert data from MI5 with status code: ' + response.statusCode);
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

function parseAlertData(xmlResponse, levels) {

    return new Promise((resolve, reject) => { 
        
        var parser = new xml2js.Parser();
            
        parser.parseString(xmlResponse, (err, result) => {
            
            if (err) {
                console.log("PARSE ERROR: " + err);
                const response = {
                    statusCode: 500,
                    body: JSON.stringify("PARSE FAILED"),
                };

                reject(response);
                return;
            }
            
            var firstChannel = result['rss']['channel'][0];
            var lastBuildDate =  new Date(firstChannel['lastBuildDate']);
            let lastBuildDateFormatted = new Date(lastBuildDate).toISOString().replace(/\..+/, '') + 'Z';
            
            var firstItem = firstChannel['item'][0];
            var threatLevelString = firstItem['description'][0];
            let pubDate = firstItem['pubDate'][0];
            
            let strippedPubDate = pubDate.substr(pubDate.indexOf(" ") + 1).replace("-", "");
            let pubDateFormatted = new Date(strippedPubDate).toISOString().replace(/\..+/, '') + 'Z';
            
            // console.log(threatLevelString);
            
            var regex = new RegExp('\\b([A-Z][A-Z][A-Z]+)', 'g');
            var uppercaseWords = threatLevelString.match(regex) ;

            // console.log(uppercaseWords.length);
            // console.log(uppercaseWords);
            // console.log(lastBuildDateFormatted);
            
            let nationalLevel = getRankForSummary(levels, uppercaseWords[0]);
            let irishLevel = getRankForSummary(levels, uppercaseWords[1]);
            let nowDate = new Date().toISOString().replace(/\..+/, '') + 'Z';

            var alert = {
                "createdDate": nowDate,
                "lastBuildDate": lastBuildDateFormatted,
                "publishedDate": pubDateFormatted,
                "nationalLevel": nationalLevel,
                "irelandLevel": irishLevel
            };      
            
            console.log("Successfully parsed alert with lastBuildDate: " + lastBuildDateFormatted)

            resolve(alert);
        });
        
    });
}

function persistCurrentAlert(alert) {

    return new Promise((resolve, reject) => { 
        alertRecordExistsInParameterStore(alert).then(alertExists => {
        
            if (alertExists) {
                console.log("Alert for publishedDate '" + alert["publishedDate"] + "' already exists in param store for Current Alert.. nothing to do.");
                resolve(alert);
                return;
            }

            console.log("Persisting current alert..");
        
            let irelandPutParam = 
                { 
                    Name: "/UKTA/PROD/irelandLevel",
                    Overwrite: true,
                    Type: "String",
                    Value: alert["irelandLevel"].toString()
                    
                }
            let nationalPutParam =
                { 
                    Name: "/UKTA/PROD/nationalLevel",
                    Overwrite: true,
                    Type: "String",
                    Value: alert["nationalLevel"].toString()
                }
            let publishedPutParam =
                { 
                    Name: "/UKTA/PROD/publishedDate",
                    Overwrite: true,
                    Type: "String",
                    Value: alert["publishedDate"]
                }
        
            updateLevelParam(irelandPutParam).then(function() {
              return updateLevelParam(nationalPutParam);  
            }).then(function() {
               return updateLevelParam(publishedPutParam); 
            }).then(function() {
                resolve(alert);
            });
        });
    });
}

function updateLevelParam(putParam) {
    return new Promise((resolve, reject) => { 
            var servmgr = new AWS.SSM();
            servmgr.putParameter(putParam, (error, data) => {
               
               if (error) {
                   reject(error);
                    return;
               } else {
                   console.log("Successfully persisted params in Parameter Manager.");
                   resolve();
               }
            });
    });
}

function persistAlertHistory(alert) {

    return new Promise((resolve, reject) => { 
        
        console.log("Persisting alert history..");
        
        
        alertRecordExistsInDb(alert).then(itemExists =>  {
            
            let alertId = alert["lastBuildDate"];

            if (itemExists) {
                console.log("Alert for lastBuildDate '" + alertId + "' already exists in history.. nothing to do.");
                resolve(alert);
                return;
            }
            
            console.log("Alert does not already exist with lastBuildDate: " + alertId);

            // TODO: need to fire off push!
            
            let documentClient = new AWS.DynamoDB.DocumentClient({
                'region': 'eu-west-1'
            });

            console.log("ALERT: " + JSON.stringify(alert));
            
            let params = { TableName: AlertTableName, 
                              Item:alert};
                         
            console.log("Creating new alert for lastBuildDate: " + alertId);     
            documentClient.put(params, function(error, data) {
                
               if (error) {
                   console.log('Could not put item: ' + error);
                   reject(error);
               } else {
                console.log("Successfully persisted new alert with lastBuildDate: " + alertId) 
                resolve(alert);        
               }
               
            });
        }).catch(error => {
            reject(error);
        });
    });
}

exports.handler = async (event, context) => {
    console.log("Beginning to fetch alerts..");

    return new Promise((resolve, reject) => {
        
        let levelsPromise = fetchLevelsFromDb();
        let alertPromise = fetchAlertData();
        
        Promise.all([levelsPromise, alertPromise]).then(values => {

            let levels = values[0];
            let xmlResponse = values[1];
            
            return parseAlertData(xmlResponse, levels);
        }).then(alert => {
            return persistCurrentAlert(alert);
        }).then(alert => {
            return persistAlertHistory(alert);
        }).then(alert => {
            const response = {
                statusCode: 200,
                body: "Successfully handled latest Alert."

            };
            resolve(response);

        }).catch(error => {
            reject(error);                            
        });
    });
};

