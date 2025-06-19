import { getYoutubeVideoId } from "../utils";

const YoutubeVideo = ({ url, width }: { url: string; width: number }) => {
  const height = (width / 16) * 9;
  const videoId = getYoutubeVideoId(url);
  const videoUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`;
  return (
    <iframe
      src={videoUrl}
      allowFullScreen
      loading="lazy"
      className="rounded-lg"
      title="Youtube Video"
      width={width}
      height={height}
    />
  );
};

export default YoutubeVideo;
