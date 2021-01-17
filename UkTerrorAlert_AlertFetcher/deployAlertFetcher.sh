echo Zipping files..
zip -r ./AlertFetcherFunction.zip ./*
echo Uploading function to AWS Lambda..
aws lambda update-function-code --function-name UkTerrorAlert_AlertFetcher --zip-file fileb://AlertFetcherFunction.zip
