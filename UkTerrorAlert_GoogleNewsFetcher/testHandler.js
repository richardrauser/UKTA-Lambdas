
// for testing async Lambda locally 

let index = require('./index');

index.handler().then(response => {
    // no response. 
    console.log('SUCCESSFULLY FINISHED. Response: ' + response);
}).catch( error => {
    console.log('ERROR: ' + error);
});