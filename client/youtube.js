let isYoutubeApiLoaded = false;
let isYoutubeApiReady = false;
const youtubeApiWaiters = [];

export function loadYoutubeApi() {
    return new Promise((resolve) => {
        if (isYoutubeApiReady) {
            return resolve(window.YT);
        }
        
        youtubeApiWaiters.push(resolve);
        
        if (!isYoutubeApiLoaded) {
            isYoutubeApiLoaded = true;
            
            // Salva a referência original se houver
            const originalCb = window.onYouTubeIframeAPIReady;
            
            window.onYouTubeIframeAPIReady = () => {
                isYoutubeApiReady = true;
                if (originalCb) originalCb();
                youtubeApiWaiters.forEach(cb => cb(window.YT));
            };
            
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }
    });
}
