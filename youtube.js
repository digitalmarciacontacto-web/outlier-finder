const axios = require('axios');

const BASE_URL = 'https://www.googleapis.com/youtube/v3';

async function getChannelUploadsPlaylistId(apiKey, channelId) {
  const res = await axios.get(`${BASE_URL}/channels`, {
    params: {
      key: apiKey,
      id: channelId,
      part: 'contentDetails',
    },
  });

  const items = res.data.items;
  if (!items || items.length === 0) throw new Error(`Canal no encontrado: ${channelId}`);
  return items[0].contentDetails.relatedPlaylists.uploads;
}

async function getPlaylistVideos(apiKey, playlistId, maxResults = 30) {
  const videoIds = [];
  let pageToken = null;

  while (videoIds.length < maxResults) {
    const params = {
      key: apiKey,
      playlistId,
      part: 'contentDetails',
      maxResults: Math.min(50, maxResults - videoIds.length),
    };
    if (pageToken) params.pageToken = pageToken;

    const res = await axios.get(`${BASE_URL}/playlistItems`, { params });
    const items = res.data.items || [];
    videoIds.push(...items.map(item => item.contentDetails.videoId));
    pageToken = res.data.nextPageToken;
    if (!pageToken || videoIds.length >= maxResults) break;
  }

  return videoIds.slice(0, maxResults);
}

async function getVideoStats(apiKey, videoIds) {
  const results = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const res = await axios.get(`${BASE_URL}/videos`, {
      params: {
        key: apiKey,
        id: chunk.join(','),
        part: 'snippet,statistics',
      },
    });
    results.push(...(res.data.items || []));
  }

  return results;
}

async function analyzeChannel(apiKey, channelId, channelName) {
  const playlistId = await getChannelUploadsPlaylistId(apiKey, channelId);
  const videoIds = await getPlaylistVideos(apiKey, playlistId, 30);
  const videos = await getVideoStats(apiKey, videoIds);

  const viewCounts = videos
    .map(v => parseInt(v.statistics.viewCount || '0', 10))
    .filter(v => v > 0);

  if (viewCounts.length === 0) return [];

  const average = viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length;

  return videos.map(video => {
    const views = parseInt(video.statistics.viewCount || '0', 10);
    const score = Math.round((views / average) * 100);
    return {
      title: video.snippet.title,
      videoId: video.id,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      channelName,
      channelId,
      views,
      averageViews: Math.round(average),
      score,
      publishedAt: video.snippet.publishedAt,
      thumbnail: video.snippet.thumbnails?.medium?.url || '',
    };
  });
}

module.exports = { analyzeChannel };
