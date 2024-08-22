import Redis from "ioredis";

const redis = new Redis(
  "rediss://default:ActiAAIjcDE5Y2JkNjIxNDE3M2U0MzdkYWVjOGVhYmM1NzA5MjVlMXAxMA@smooth-flea-52066.upstash.io:6379"
);
export default redis;
