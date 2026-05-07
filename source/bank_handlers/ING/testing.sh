#!/bin/bash

# Note: current script was tested with the following combinations:
# curl 8.6.0 and OpenSSL 3.2.1 and bash version GNU bash, version 3.2.57(1)-release (arm64-apple-darwin23)
# curl 8.7.1 and OpenSSL 3.1.4 and bash version GNU bash, version 3.2.57(1)-release (arm64-apple-darwin23)
# curl 8.7.1 and LibreSSL 3.3.6 and bash version GNU bash, version 3.2.57(1)-release (x86_64-apple-darwin23)
# curl 8.9.1 and OpenSSL 3.2.2 and bash version GNU bash, version 5.2.26(1)-release (x86_64-pc-msys) windows 10

# In order to use the script for production environment, replace:
# httpHost with "https://api.ing.com"
# signCertificate and signKey with your own signing certificates
# tlsCertificate and tlsKey with your own PSD2 tls certificates
# payload with your request body

httpHost="https://api.sandbox.ing.com"

## THE SCRIPT USES THE DOWNLOADED EXAMPLE EIDAS CERTIFICATES
signCertificate="./certs/example_client_signing.cer"
signKey="./certs/example_client_signing.key"
tlsCertificate="./certs/example_client_tls.cer"
tlsKey="./certs/example_client_tls.key"


###############################################################################
#                        1. GENERATE JWS SIGNATURE                            #
# Issues might appear for RSA-PSS with older OpenSSL versions.                #
###############################################################################

httpMethod="POST"
reqPath="/oauth2/applications"

payload="{ \"contact\": \"test@ingsandbox.com\", \"redirect_uris\":[ \"https://example.com\", \"https://another-example.com\"]}"
echo Creating x-jws-signature for calling "$httpMethod" "$reqPath" with payload "$payload"

## Step 1: Create JWS Protected Header
# Description: Produce JWS header parameters which define how the signature is created.

# generate the sha-256, Base64url, for the signing certificate
base64UrlFingerprint=$(openssl x509 -noout -fingerprint -sha256 -inform pem -in $signCertificate | cut -d'=' -f2 | sed s/://g  | xxd -r -p | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')
echo Base64url for the signing certificate: "$base64UrlFingerprint"

# generate the current signing time, encoded using RFC 3339 Internet time format for UTC without fractional seconds (e.g. "2019-11-19T17:28:15Z")
sigT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo Current signing time: "$sigT"

# create the JWS Protected Header with the sigD parameters containing the mandatory headers
jwsHeader='{"b64":false,"x5t#S256":"'"$base64UrlFingerprint"'","crit":[ "sigT", "sigD", "b64"],"sigT":"'"$sigT"'","sigD":{ "pars":[ "(request-target)", "digest", "content-type" ], "mId":"http://uri.etsi.org/19182/HttpHeaders"},"alg":"PS256"}'
echo JWS Protected Header: "$jwsHeader"

## Step 2: Encode JWS Protected Header into Base64url
# Description: Convert JWS Protected Header (without line breaks or extra spaces) into a Base64url encoded string.
jwsHeaderBase64URL=$(echo -n "$jwsHeader" | openssl base64 -e -A | tr -d '=' | tr '/+' '_-' | tr -d '\n')
echo Encoded JWS Protected Header: "$jwsHeaderBase64URL"

## Step 3a: Compute Digest of HTTP Body
# Description: Calculate hash of the HTTP Body (payload without HTTP header and following empty line).
digest="SHA-256="$(echo -n "$payload" | openssl dgst -binary -sha256 | openssl base64)
echo Digest of HTTP Body: "$digest"

## Step 3b: Collect HTTP Headers to be signed
# Description: Create HTTP header string, as selected using the JWS header parameter sigD, including Digest (base64 encoded).
# After each line, a line feed must be present.
lowerCaseHttpMethod=`echo $httpMethod | tr [:upper:] [:lower:]`

signingString="(request-target): $lowerCaseHttpMethod $reqPath
digest: $digest
content-type: application/json"
echo HTTP Headers to be signed: "$signingString"

## Step 4: Prepare input for Signature Value Computation
# Description: Combine Base64url encoded JWS Protected Header with HTTP Header to be signed, separated by ".", ready for computation of signature value.
inputForSignatureValueComputation="$jwsHeaderBase64URL.$signingString"

## Step 5: Compute JWS Signature Value
# Description: Compute the digital signature cryptographic value calculated over a sequence of octets derived from the JWS Protected Header and HTTP Header Data to be Signed.
# This is created using the signing key associated with the certificate identified in the JWS Protected Header "x5t#S256" and using the signature algorithm identified by "alg".
jwsSignatureValue=$(printf %s "$inputForSignatureValueComputation"| openssl dgst -sha256 -sign $signKey -sigopt rsa_padding_mode:pss | openssl base64 -A  | tr -d '=' | tr '/+' '_-' | tr -d '\n')
echo JWS Signature Value: "$jwsSignatureValue"

## Step 6: Build JSON Web Signature
# Description: Create JSON Web Signature containing the Base64url encoded JWS Protected header and ".." and the JWS Signature Value.
# This is encoded using JWS compact serialisation with the HTTP Header Data to be Signed detached from the signature.
jwsSignature=$jwsHeaderBase64URL..$jwsSignatureValue
echo x-jws-signature: "$jwsSignature"

###############################################################################
#                                2. ONBOARDING                                #
###############################################################################

response=$(curl -k -vv -X "$httpMethod" "${httpHost}${reqPath}" \
           -H 'Content-Type: application/json' \
           -H "Digest: $digest" \
           -H "x-jws-signature: $jwsSignature" \
           -H "TPP-Signature-Certificate: $(tr -d "\n\r" < $signCertificate)" \
           -d "$payload" \
           --cert $tlsCertificate \
           --key $tlsKey)

echo "$response" | jq '.'