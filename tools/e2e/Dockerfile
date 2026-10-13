# The Playwright image with Latin fonts. Without them every font falls back to WenQuanYi Zen Hei,
# so screenshots and text widths look nothing like an iPhone. Inter is the closest open font to
# SF Pro, and JetBrains Mono stands in for SF Mono; fonts.conf maps the app's font names to them.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-inter fonts-jetbrains-mono \
  && rm -rf /var/lib/apt/lists/*
COPY fonts.conf /etc/fonts/local.conf
RUN fc-cache -f
