echo Zipping files..
zip -r ./GoogleNewsFetcherFunction.zip ./*
echo Uploading function to AWS Lambda..
aws lambda update-function-code --function-name UkTerrorAlert_GoogleNewsFetcher --zip-file fileb://GoogleNewsFetcherFunction.zip
