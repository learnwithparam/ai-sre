# booking-web. The release is baked into the image, so v1 and v2 are two images and a rollback is a redeploy.
FROM oven/bun:1.4.4-slim
ARG BOOKING_RELEASE=v1
ENV BOOKING_RELEASE=${BOOKING_RELEASE} NODE_ENV=production
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY world/booking-web/src world/booking-web/src
COPY world/config/fares world/config/fares
EXPOSE 8000
CMD ["bun", "world/booking-web/src/server.ts"]
