#!/bin/bash
while IFS='=' read -r key value; do
  # Skip comments and empty lines
  [[ $key =~ ^#.* ]] && continue
  [[ -z "$key" ]] && continue
  
  # Remove quotes and unescape newlines if any
  # Vercel env add doesn't strictly need quotes removed if we echo it
  clean_val=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e 's/\\n//g')
  
  # Skip VERCEL_ generated vars
  [[ $key == VERCEL_* ]] && continue
  [[ $key == TURBO_* ]] && continue
  [[ $key == NX_* ]] && continue
  
  echo "Adding $key..."
  echo -n "$clean_val" | npx vercel env add "$key" production
  echo -n "$clean_val" | npx vercel env add "$key" preview
  echo -n "$clean_val" | npx vercel env add "$key" development
done < .env.vk-tickets
