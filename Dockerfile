FROM nginx:alpine

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy all static assets into the default Nginx public serving directory
COPY . /usr/share/nginx/html/

# Expose port 80 (default Nginx port)
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
