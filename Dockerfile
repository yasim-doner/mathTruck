FROM nginx:alpine

# Copy all static assets into the default Nginx public serving directory
COPY . /usr/share/nginx/html/

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
